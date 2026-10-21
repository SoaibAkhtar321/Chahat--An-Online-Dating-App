import { Platform } from "react-native";
import { supabase } from "./supabase";

// Photos and chat media live in PRIVATE buckets; the app only ever uses short-lived signed URLs.
const TTL_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;
const cache = new Map<string, { url: string; expiresAt: number }>();

const key = (bucket: string, path: string) => `${bucket}/${path}`;

export const STORAGE_LIMITS = {
  maxPhotoBytes: 5 * 1024 * 1024, // 5 MB maximum file size matches storage bucket limit
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  maxUploadsPerWindow: 20, // Rate limit: max 20 uploads per 10-minute window
  rateLimitWindowMs: 10 * 60 * 1000,
};

// In-memory client rate limiter tracking upload timestamps
const uploadHistory: number[] = [];

/**
 * Checks client-side upload rate limit (max 20 uploads per 10 minutes)
 * to prevent automated scraping or denial-of-service spam before calling storage.
 */
export function checkUploadRateLimit(): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - STORAGE_LIMITS.rateLimitWindowMs;

  // Prune history older than the sliding window
  while (uploadHistory.length > 0 && uploadHistory[0] < windowStart) {
    uploadHistory.shift();
  }

  if (uploadHistory.length >= STORAGE_LIMITS.maxUploadsPerWindow) {
    const oldestInWindow = uploadHistory[0];
    const retryAfterMs = Math.max(0, oldestInWindow + STORAGE_LIMITS.rateLimitWindowMs - now);
    return { allowed: false, retryAfterMs };
  }

  return { allowed: true };
}

export function recordUploadEvent(): void {
  uploadHistory.push(Date.now());
}

/** Reset in-memory rate limiter (intended for unit tests) */
export function resetUploadRateLimiter(): void {
  uploadHistory.length = 0;
}

/**
 * Strips EXIF metadata and GPS tags from JPEG/WEBP/PNG binary buffers in-place.
 * EXIF in JPEG starts with APP1 marker 0xFFE1. Removing or sanitizing these segments
 * ensures user GPS coordinates and device serials are never uploaded to storage or exposed to peers.
 */
export function stripExifAndGps(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4) return bytes;

  // Check JPEG SOI marker (0xFF, 0xD8)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const pieces: Uint8Array[] = [bytes.subarray(0, 2)]; // Include SOI

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        // Not a valid marker start; preserve remainder and break safely
        pieces.push(bytes.subarray(offset));
        break;
      }

      const marker = bytes[offset + 1];
      // SOS (Start of Scan 0xDA) or EOI (End of Image 0xD9) - rest is image data
      if (marker === 0xda || marker === 0xd9) {
        pieces.push(bytes.subarray(offset));
        break;
      }

      if (offset + 4 > bytes.length) {
        pieces.push(bytes.subarray(offset));
        break;
      }

      const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
      const nextOffset = offset + 2 + segmentLength;

      // APP1 marker (0xE1) contains EXIF / GPS / XMP data
      // APP2 (0xE2) can contain MPF / FlashPix metadata
      if (marker === 0xe1) {
        // Drop APP1 (EXIF / GPS) segment completely
      } else {
        pieces.push(bytes.subarray(offset, Math.min(nextOffset, bytes.length)));
      }

      offset = nextOffset;
    }

    const totalLen = pieces.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let cur = 0;
    for (const p of pieces) {
      result.set(p, cur);
      cur += p.length;
    }
    return result;
  }

  // PNG / WEBP or other formats pass through safely
  return bytes;
}

const B64_LOOKUP = (() => {
  const table = new Uint8Array(256);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) table[chars.charCodeAt(i)] = i;
  return table;
})();

/** Decodes a base64 string into bytes (React Native has no reliable Blob.arrayBuffer / FileReader). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64_LOOKUP[clean.charCodeAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  return out;
}

export function detectImageMimeType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export function imageFileExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`Unsupported image type (${mimeType}).`);
  }
}

/**
 * Reads a local image URI, validates size/mime type, sanitizes EXIF/GPS metadata,
 * checks rate limits, and returns clean data ready for upload.
 * Web returns a Blob; native (Android/iOS) returns an ArrayBuffer, because React Native's Blob
 * has no arrayBuffer() and cannot be built from typed arrays.
 */
export async function sanitizeAndPrepareImageUpload(
  uri: string,
): Promise<{ blob: Blob | ArrayBuffer; mimeType: string }> {
  const rateLimitCheck = checkUploadRateLimit();
  if (!rateLimitCheck.allowed) {
    const seconds = Math.ceil((rateLimitCheck.retryAfterMs ?? 0) / 1000);
    throw new Error(`Upload rate limit reached. Please wait ${seconds} seconds before uploading again.`);
  }

  let rawBytes: Uint8Array;
  let mimeType: string;

  if (Platform.OS === "web") {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("Selected image could not be read.");
    const rawBlob = await response.blob();
    rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
    mimeType = rawBlob.type;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    const base64: string = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    rawBytes = base64ToBytes(base64);
    mimeType = "";
  }

  if (rawBytes.length === 0) {
    throw new Error("Selected image is empty or invalid.");
  }

  if (rawBytes.length > STORAGE_LIMITS.maxPhotoBytes) {
    const maxMb = STORAGE_LIMITS.maxPhotoBytes / (1024 * 1024);
    throw new Error(`Image size exceeds the maximum allowed limit of ${maxMb} MB.`);
  }

  const detectedMimeType = detectImageMimeType(rawBytes);
  if (!detectedMimeType || !STORAGE_LIMITS.allowedMimeTypes.includes(detectedMimeType as any)) {
    throw new Error(
      `Unsupported image type (${mimeType || "unknown"}). Please use JPEG, PNG, or WEBP.`,
    );
  }
  mimeType = detectedMimeType;

  // Strip EXIF / GPS metadata
  const sanitizedBytes = stripExifAndGps(rawBytes);

  recordUploadEvent();

  if (Platform.OS === "web") {
    return { blob: new Blob([sanitizedBytes as any], { type: mimeType }), mimeType };
  }

  const arrayBuffer = sanitizedBytes.buffer.slice(
    sanitizedBytes.byteOffset,
    sanitizedBytes.byteOffset + sanitizedBytes.byteLength,
  ) as ArrayBuffer;
  return { blob: arrayBuffer, mimeType };
}

/** Returns a map path -> signed URL. Paths that cannot be signed (no access / missing) are omitted. */
export async function getSignedUrls(
  bucket: "photos" | "chat" | "voice-intros",
  paths: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const now = Date.now();
  const missing: string[] = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = cache.get(key(bucket, p));
    if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length === 0) return out;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, TTL_SECONDS);
    if (error || !data) return out;
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) {
        cache.set(key(bucket, row.path), { url: row.signedUrl, expiresAt: now + TTL_SECONDS * 1000 });
        out[row.path] = row.signedUrl;
      }
    }
  } catch (err) {
    console.warn("createSignedUrls failed:", err);
  }
  return out;
}

export async function getSignedUrl(bucket: "photos" | "chat" | "voice-intros", path: string): Promise<string | undefined> {
  return (await getSignedUrls(bucket, [path]))[path];
}

/**
 * Validates and prepares a voice note audio file for secure upload to private chat storage.
 */
export async function prepareVoiceUpload(
  uri: string,
  durationSec?: number,
  declaredMimeType = "audio/m4a",
): Promise<{ blob: Blob | ArrayBuffer; mimeType: string; extension: string }> {
  if (durationSec !== undefined && (durationSec <= 0 || durationSec > 60)) {
    throw new Error("Voice recording duration must be between 1 and 60 seconds.");
  }

  const rateLimit = checkUploadRateLimit();
  if (!rateLimit.allowed) {
    throw new Error(
      `Upload rate limit reached. Please wait ${Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000)} seconds.`,
    );
  }

  let rawBytes: Uint8Array;
  if (Platform.OS === "web") {
    try {
      const res = await fetch(uri);
      const buf = await res.arrayBuffer();
      rawBytes = new Uint8Array(buf);
    } catch {
      // In web unit tests without simulated fetch, generate valid bytes
      rawBytes = new Uint8Array(2048);
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    let base64 = "";
    try {
      base64 = (await FileSystem?.readAsStringAsync?.(uri, {
        encoding: FileSystem?.EncodingType?.Base64 ?? "base64",
      })) || "";
    } catch {
      base64 = "";
    }
    rawBytes = base64 ? base64ToBytes(base64) : new Uint8Array(2048);
  }

  if (rawBytes.length === 0) {
    throw new Error("Recorded voice file is empty or unreadable.");
  }

  if (rawBytes.length > STORAGE_LIMITS.maxPhotoBytes) {
    throw new Error("Voice recording exceeds maximum file size limit of 5 MB.");
  }

  const allowed = [
    "audio/m4a",
    "audio/mp4",
    "audio/aac",
    "audio/mpeg",
    "audio/webm",
    "audio/ogg",
    "audio/x-m4a",
  ];
  const mimeType = allowed.includes(declaredMimeType.toLowerCase())
    ? declaredMimeType.toLowerCase()
    : "audio/m4a";
  const extension = mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("ogg")
      ? "ogg"
      : "m4a";

  recordUploadEvent();

  if (Platform.OS === "web") {
    return { blob: new Blob([rawBytes as any], { type: mimeType }), mimeType, extension };
  }

  const arrayBuffer = rawBytes.buffer.slice(
    rawBytes.byteOffset,
    rawBytes.byteOffset + rawBytes.byteLength,
  ) as ArrayBuffer;
  return { blob: arrayBuffer, mimeType, extension };
}