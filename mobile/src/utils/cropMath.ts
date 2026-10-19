/** Largest centered crop rectangle with the given width/height ratio (default 3:4 portrait). */
export function centerCropRect(
  width: number,
  height: number,
  ratio: number = 3 / 4,
): { originX: number; originY: number; width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { originX: 0, originY: 0, width: 0, height: 0 };
  let cw = width;
  let ch = height;
  if (width / height > ratio) cw = Math.floor(height * ratio);
  else ch = Math.floor(width / ratio);
  return {
    originX: Math.floor((width - cw) / 2),
    originY: Math.floor((height - ch) / 2),
    width: cw,
    height: ch,
  };
}
