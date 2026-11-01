// Receipt scanning client. Mirrors backend/models/receipts.py (ReceiptScanRequest / ReceiptScan).
import { apiPost, ApiError } from "./api";
import type { ExpenseCategory } from "./types";

export interface ReceiptScan {
  merchant: string;
  amount: number | null;
  currency: string;
  date: string | null;
  category: ExpenseCategory;
  confidence: "high" | "medium" | "low";
  is_receipt: boolean;
}

/** Downscale a photo to ≤1600px JPEG so phone camera shots upload quickly. Returns a data URL. */
export async function compressImage(file: File, max = 1600, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't open that image"));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const scanReceipt = (dataUrl: string) =>
  apiPost<ReceiptScan>("/receipts/scan", { image_base64: dataUrl.split(",", 2)[1], mime_type: "image/jpeg" });

export function scanErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") return detail;
    if (err.status === 422) return "That image couldn't be read. Try a JPG or PNG photo.";
    return "Receipt scanning is unavailable right now. You can still enter the expense manually.";
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
