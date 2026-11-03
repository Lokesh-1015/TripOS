import sharp from "sharp";

// The free server has little memory, so images are handled one at a time and nothing is kept around.
sharp.cache(false);
sharp.concurrency(1);

const MAX_SIDE = 4096;

/** Images we can rewrite without their hidden details, such as the GPS position a phone records. */
export const CLEANABLE_IMAGES = ["image/jpeg", "image/png", "image/webp"];

/** What a file really is, going by its first bytes rather than by what the browser claimed. */
export function detectType(data: Buffer): string | null {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString("latin1");
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return "video/webm";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

/** Rewrites an image without its metadata, keeping it the right way up. Throws if it isn't really an image. */
export async function removeImageMetadata(data: Buffer, mimeType: string) {
  const image = sharp(data).rotate().keepIccProfile().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
  if (mimeType === "image/png") return image.png().toBuffer();
  if (mimeType === "image/webp") return image.webp({ quality: 88 }).toBuffer();
  return image.jpeg({ quality: 88 }).toBuffer();
}
