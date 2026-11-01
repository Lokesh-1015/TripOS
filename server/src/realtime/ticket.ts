import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// One server for now, so a per-boot secret is enough: clients fetch a new ticket whenever they reconnect.
const SECRET = randomBytes(32);
const TICKET_MS = 60 * 1000;

const sign = (payload: string) => createHmac("sha256", SECRET).update(payload).digest("base64url");

/** Short-lived proof of a logged-in session, for opening one live-updates connection. */
export function issueTicket(userId: string) {
  const payload = `${userId}.${Date.now() + TICKET_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function userFromTicket(ticket: unknown): string | null {
  if (typeof ticket !== "string") return null;
  const [userId, expires, signature] = ticket.split(".");
  if (!userId || !expires || !signature) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return Number(expires) > Date.now() ? userId : null;
}
