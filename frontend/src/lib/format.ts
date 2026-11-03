import { differenceInCalendarDays, format, parseISO, formatDistanceToNowStrict } from "date-fns";
import type { Expense, ExpenseCategory, Settlement, Trip, TripStatus } from "./types";

export const CURRENCIES: { code: string; label: string }[] = [
  { code: "INR", label: "₹ Indian Rupee" },
  { code: "USD", label: "$ US Dollar" },
  { code: "EUR", label: "€ Euro" },
  { code: "GBP", label: "£ British Pound" },
  { code: "AED", label: "AED UAE Dirham" },
  { code: "SGD", label: "S$ Singapore Dollar" },
  { code: "THB", label: "฿ Thai Baht" },
];

export function money(amount: number, currency = "INR", compact = false): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact || Number.isInteger(amount) ? 0 : 2,
    notation: compact && Math.abs(amount) >= 100000 ? "compact" : "standard",
  }).format(amount);
}

export const todayISO = () => format(new Date(), "yyyy-MM-dd");
export const fmtDate = (iso: string, f = "dd MMM yyyy") => format(parseISO(iso), f);
export const fmtRange = (a: string, b: string) => {
  const s = parseISO(a), e = parseISO(b);
  return s.getFullYear() === e.getFullYear()
    ? `${format(s, "dd MMM")} - ${format(e, "dd MMM yyyy")}`
    : `${format(s, "dd MMM yyyy")} - ${format(e, "dd MMM yyyy")}`;
};
export const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
export const tripDays = (t: Trip) => differenceInCalendarDays(parseISO(t.endDate), parseISO(t.startDate)) + 1;
export const daysUntil = (iso: string) => differenceInCalendarDays(parseISO(iso), new Date());

/** Who has actually joined. Invitations don't hold a place. */
export const joinedCount = (trip: Pick<Trip, "members">) => trip.members.filter((m) => (m.status ?? "active") === "active").length;
export const isTripFull = (trip: Pick<Trip, "members" | "maxParticipants">) => trip.maxParticipants != null && joinedCount(trip) >= trip.maxParticipants;

export function tripStatus(t: Trip): TripStatus {
  if (t.archived) return "archived";
  const today = todayISO();
  if (today < t.startDate) return "upcoming";
  if (today > t.endDate) return "completed";
  return "ongoing";
}

export const STATUS_LABEL: Record<TripStatus, string> = {
  upcoming: "Upcoming", ongoing: "Ongoing", completed: "Completed", archived: "Archived",
};

export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  stay: "Stay", food: "Food & drinks", transport: "Transport", activities: "Activities", shopping: "Shopping", other: "Other",
};
export const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  stay: "#174C3C", food: "#F28B68", transport: "#6FA28C", activities: "#E8C16B", shopping: "#8AA7C4", other: "#B8BFB9",
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split an amount equally (to the paisa/cent), pushing any rounding remainder onto the first participant. */
export function equalShares(amount: number, ids: string[]) {
  if (!ids.length) return [];
  const base = Math.floor((amount / ids.length) * 100) / 100;
  const rem = round2(amount - base * ids.length);
  return ids.map((memberId, i) => ({ memberId, amount: round2(base + (i === 0 ? rem : 0)) }));
}

/** Whether changing the currency would need converting existing amounts. */
export const hasAmounts = (t: Trip) => t.budget > 0 || t.perPersonBudget > 0 || t.expenses.length > 0 || t.settlements.length > 0 || t.activities.some((a) => a.cost > 0);

export const totalSpent = (t: Trip) => round2(t.expenses.reduce((s, e) => s + e.amount, 0));

/** Net balance per member: positive = should receive, negative = owes. Settlements already paid are applied. */
export function balances(members: { id: string }[], expenses: Expense[], settlements: Settlement[]) {
  const b: Record<string, number> = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    b[e.paidBy] = (b[e.paidBy] ?? 0) + e.amount;
    for (const s of e.shares) b[s.memberId] = (b[s.memberId] ?? 0) - s.amount;
  }
  for (const s of settlements) {
    b[s.from] = (b[s.from] ?? 0) + s.amount;
    b[s.to] = (b[s.to] ?? 0) - s.amount;
  }
  for (const k in b) b[k] = round2(b[k]);
  return b;
}

/** Greedy min-transfer settlement: match largest debtor with largest creditor until all are square. */
export function suggestTransfers(bal: Record<string, number>) {
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.009).map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(bal).filter(([, v]) => v > 0.009).map(([id, v]) => ({ id, v }));
  debtors.sort((a, b) => b.v - a.v);
  creditors.sort((a, b) => b.v - a.v);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = round2(Math.min(debtors[i].v, creditors[j].v));
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: amt });
    debtors[i].v = round2(debtors[i].v - amt);
    creditors[j].v = round2(creditors[j].v - amt);
    if (debtors[i].v <= 0.009) i++;
    if (creditors[j].v <= 0.009) j++;
  }
  return out;
}

export const uid = (p = "id") => `${p}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
export const initials = (name: string) => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
