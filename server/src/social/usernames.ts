import { randomInt } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Instagram-style: 3 to 30 letters, numbers, underscores and periods, never starting or ending with a period
 * or with two in a row. Always stored in lowercase, which makes them case-insensitive. The database checks the
 * same rule, so nothing can store a username this would reject.
 */
export const USERNAME = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{3,30}$/;
export const USERNAME_RULES = "Use 3 to 30 letters, numbers, underscores or periods, not starting or ending with a period";
export const RESERVED_USERNAMES = new Set(["admin", "administrator", "moderator", "support", "help", "tripos", "official", "me", "settings", "system", "null", "undefined", "former"]);
export const USERNAME_COOLDOWN_DAYS = 30;
const COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** Accepts "@Asha.Rao" as well as "asha.rao". */
export const normalizeUsername = (raw: string) => raw.trim().replace(/^@/, "").toLowerCase();

/** When this person may next pick a new username. Null means now. */
export function nextUsernameChange(changedAt: Date | null) {
  if (!changedAt) return null;
  const next = new Date(changedAt.getTime() + COOLDOWN_MS);
  return next > new Date() ? next : null;
}

/** Why a username can't be used, or null if it's free. */
export async function usernameProblem(db: Pick<Prisma.TransactionClient, "user">, username: string, ownerId?: string) {
  if (!USERNAME.test(username)) return USERNAME_RULES;
  if (RESERVED_USERNAMES.has(username) || username.startsWith("former.")) return "That username isn't available";
  const taken = await db.user.findUnique({ where: { username }, select: { id: true } });
  return taken && taken.id !== ownerId ? "That username is taken" : null;
}

/** A free username made from someone's name, such as "asharao4821", for every new account. They can change it. */
export async function suggestUsername(db: Pick<Prisma.TransactionClient, "user">, name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 20);
  const stem = base.length >= 3 ? base : "traveller";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${stem}${randomInt(attempt < 10 ? 1000 : 100_000, attempt < 10 ? 10_000 : 1_000_000)}`;
    if (!(await db.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `${stem}${Date.now().toString(36)}`.slice(0, 30);
}

/** What a deleted account's username becomes, so the old one is free for someone else. */
export const formerUsername = (userId: string) => `former.${userId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 22)}`;
