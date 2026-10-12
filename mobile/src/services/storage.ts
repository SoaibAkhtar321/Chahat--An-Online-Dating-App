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

/**
 * Reads a local image URI, validates size/mime type, sanitizes EXIF/GPS metadata,
 * checks rate limits, and returns a clean Blob ready for upload.
 */
export async function sanitizeAndPrepareImageUpload(
  uri: string,
  expectedType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<{ blob: Blob; mimeType: string }> {
  const rateLimitCheck = checkUploadRateLimit();
  if (!rateLimitCheck.allowed) {
    const seconds = Math.ceil((rateLimitCheck.retryAfterMs ?? 0) / 1000);
    throw new Error(`Upload rate limit reached. Please wait ${seconds} seconds before uploading again.`);
  }

  const response = await fetch(uri);
  const rawBlob = await response.blob();

  if (rawBlob.size === 0) {
    throw new Error("Selected image is empty or invalid.");
  }

  if (rawBlob.size > STORAGE_LIMITS.maxPhotoBytes) {
    const maxMb = STORAGE_LIMITS.maxPhotoBytes / (1024 * 1024);
    throw new Error(`Image size exceeds the maximum allowed limit of ${maxMb} MB.`);
  }

  const mimeType = (rawBlob.type as any) || expectedType;
  if (!STORAGE_LIMITS.allowedMimeTypes.includes(mimeType as any)) {
    throw new Error(`Unsupported image type (${mimeType}). Please use JPEG, PNG, or WEBP.`);
  }

  // Convert to ArrayBuffer -> Uint8Array to strip EXIF / GPS metadata
  const arrayBuffer = await rawBlob.arrayBuffer();
  const rawBytes = new Uint8Array(arrayBuffer);
  const sanitizedBytes = stripExifAndGps(rawBytes);

  recordUploadEvent();

  const sanitizedBlob = new Blob([sanitizedBytes as any], { type: mimeType });
  return { blob: sanitizedBlob, mimeType };
}

/** Returns a map path -> signed URL. Paths that cannot be signed (no access / missing) are omitted. */
export async function getSignedUrls(
  bucket: "photos" | "chat",
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

export async function getSignedUrl(bucket: "photos" | "chat", path: string): Promise<string | undefined> {
  return (await getSignedUrls(bucket, [path]))[path];
}
