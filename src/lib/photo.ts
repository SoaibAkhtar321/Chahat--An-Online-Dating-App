// Real, local image processing for profile photos (browser canvas, no extra dependency).
// The prototype keeps the compressed result in this browser only — nothing is uploaded.
// In the production app the same settings apply before uploading to storage.

export const PHOTO_CONFIG = {
  types: ["image/jpeg", "image/png", "image/webp"],
  maxInputBytes: 15 * 1024 * 1024,
  minShortSide: 320, // smaller originals look blurry on a full-screen profile
  maxPixels: 50_000_000,
  maxDim: 1280, // longest side of the full-profile image
  quality: 0.8,
  thumbDim: 360, // longest side of the card/avatar thumbnail
  thumbQuality: 0.7,
  maxPhotos: 6,
};

export type ProcessedPhoto = {
  src: string;
  thumb: string;
  w: number;
  h: number;
  kb: number;
  originalKb: number;
  sig: string;
};

export class PhotoError extends Error {}

export const fileSig = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function validateFile(f: File): string | null {
  if (!PHOTO_CONFIG.types.includes(f.type)) return "Use a JPG, PNG or WEBP photo";
  if (f.size === 0) return "This file is empty";
  if (f.size > PHOTO_CONFIG.maxInputBytes)
    return `Too large (max ${PHOTO_CONFIG.maxInputBytes / 1024 / 1024} MB)`;
  return null;
}

const dataUrlKb = (d: string) => Math.round(((d.length - d.indexOf(",") - 1) * 3) / 4 / 1024);

function encode(bmp: ImageBitmap, maxDim: number, quality: number) {
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale),
    h = Math.round(bmp.height * scale); // aspect ratio preserved
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new PhotoError("Your browser couldn't process this photo");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  let out = c.toDataURL("image/webp", quality);
  if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", quality); // Safari fallback
  c.width = 0;
  c.height = 0; // release canvas memory
  return { out, w, h };
}

/** Decodes, validates dimensions, then resizes + compresses into a display image and a thumbnail. */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const bad = validateFile(file);
  if (bad) throw new PhotoError(bad);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("This file looks damaged or isn't a supported image");
  }
  try {
    const short = Math.min(bmp.width, bmp.height);
    if (short < PHOTO_CONFIG.minShortSide)
      throw new PhotoError(
        `Too small (${bmp.width}×${bmp.height}). Use at least ${PHOTO_CONFIG.minShortSide}px on the short side`,
      );
    if (bmp.width * bmp.height > PHOTO_CONFIG.maxPixels)
      throw new PhotoError("Image resolution is too high");
    const full = encode(bmp, PHOTO_CONFIG.maxDim, PHOTO_CONFIG.quality);
    const thumb = encode(bmp, PHOTO_CONFIG.thumbDim, PHOTO_CONFIG.thumbQuality);
    return {
      src: full.out,
      thumb: thumb.out,
      w: full.w,
      h: full.h,
      kb: dataUrlKb(full.out) + dataUrlKb(thumb.out),
      originalKb: Math.round(file.size / 1024),
      sig: fileSig(file),
    };
  } finally {
    bmp.close();
  }
}
