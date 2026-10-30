import * as ImageManipulator from "expo-image-manipulator";

/** Target size for every profile photo: under 1 MB. */
export const MAX_PROFILE_PHOTO_BYTES = 1_000_000;

const START_WIDTH = 1080; // 1080x1440 for a 3:4 photo is plenty for a profile card
const MIN_WIDTH = 480;
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];

async function sizeOf(uri: string): Promise<number> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error("Selected image could not be read for compression.");
  const blob = await res.blob();
  if (blob.size === 0) throw new Error("Selected image is empty or invalid.");
  return blob.size;
}

/**
 * Resizes and re-encodes a picked image as JPEG until it is under maxBytes.
 * Tries quality 0.8 first and only goes lower (then smaller) if the file is still too big.
 * Re-encoding also drops EXIF/GPS metadata. Returns the URI of the compressed file.
 */
export async function compressToUnderLimit(
  uri: string,
  originalWidth?: number,
  maxBytes: number = MAX_PROFILE_PHOTO_BYTES,
): Promise<string> {
  let width =
    originalWidth && originalWidth > 0 && originalWidth < START_WIDTH ? originalWidth : START_WIDTH;

  while (width >= MIN_WIDTH) {
    for (const quality of QUALITIES) {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], {
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const size = await sizeOf(out.uri);
      if (size <= maxBytes) return out.uri;
    }
    width = Math.floor(width * 0.8);
  }

  throw new Error("This photo could not be made small enough. Please choose a different photo.");
}

/** Chat photos: plenty for a phone screen, and a fraction of a camera original (often 4–8 MB). */
export const CHAT_PHOTO_MAX_WIDTH = 1600;
export const MAX_CHAT_PHOTO_BYTES = 600_000;

const GIF_BASE64_PREFIX = "R0lGOD"; // "GIF8" in base64

/** True when the file starts with a GIF header (animated GIFs must be sent as they are). */
export async function isGifFile(uri: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system/legacy");
    const head: string = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 6,
    });
    return head.startsWith(GIF_BASE64_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Prepares a chat photo before upload: GIFs are kept as they are; every other image is re-encoded as JPEG, at most
 * CHAT_PHOTO_MAX_WIDTH wide (never enlarged) and under MAX_CHAT_PHOTO_BYTES. Re-encoding also drops EXIF/GPS.
 */
export async function compressChatImage(uri: string): Promise<string> {
  if (await isGifFile(uri)) return uri;
  const probe = await ImageManipulator.manipulateAsync(uri, [], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
  let width = Math.min(probe.width || CHAT_PHOTO_MAX_WIDTH, CHAT_PHOTO_MAX_WIDTH);
  while (width >= MIN_WIDTH) {
    for (const quality of [0.75, 0.65, 0.55, 0.45]) {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width } }], {
        compress: quality,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      if ((await sizeOf(out.uri)) <= MAX_CHAT_PHOTO_BYTES) return out.uri;
    }
    width = Math.floor(width * 0.8);
  }
  throw new Error("This photo could not be made small enough to send. Please choose a different photo.");
}
