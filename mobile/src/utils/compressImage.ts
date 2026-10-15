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