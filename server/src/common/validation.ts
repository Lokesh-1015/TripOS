import { UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";

/** Validates a request body; a failure is a 422 whose message can be shown to the user. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.join(".");
  throw new UnprocessableEntityException({ message: `${path ? `${path}: ` : ""}${issue?.message ?? "Invalid request"}` });
}

// Client-generated ids (uid() in the UI) make creates idempotent and optimistic updates reconcilable.
export const clientId = z.string().regex(/^[\w-]{1,64}$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
export const money = z.number().finite().nonnegative().max(10_000_000);
export const version = z.number().int().positive().optional();
export const shortText = z.string().trim().max(500);
export const longText = z.string().max(5000);

/** Images may only come from our own file route or the UI's preset photo CDN. */
export const imageRef = z
  .string()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/api/files/") || v.startsWith("https://images.unsplash.com/"), "Unsupported image source");

export const asDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const dateString = (d: Date) => d.toISOString().slice(0, 10);
