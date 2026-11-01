import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Runs the same work for an unknown email, so timing doesn't reveal which accounts exist.
  const [, salt, key] = (stored ?? `scrypt$${randomBytes(16).toString("base64url")}$${randomBytes(KEY_LENGTH).toString("base64url")}`).split("$");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64url"), KEY_LENGTH);
  return timingSafeEqual(actual, Buffer.from(key, "base64url")) && stored !== null;
}

export const newToken = () => randomBytes(32).toString("base64url");
/** Only hashes are stored, so a leaked backup can't be used to take over sessions. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
