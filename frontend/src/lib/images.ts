// Phone photos are far bigger than a screen needs. Shrinking them first keeps uploads quick on a poor
// connection and makes the free storage last. The server still checks and cleans whatever arrives.
const MAX_SIDE = 2000;
const QUALITY = 0.85;
const WORTH_SHRINKING_BYTES = 500 * 1024;
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** A smaller copy of a photo, or the original if it's already small or can't be read here. */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!SHRINKABLE.has(file.type) || file.size < WORTH_SHRINKING_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
  } catch {
    return file;
  }
}
