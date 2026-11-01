// The UI works in major units (₹12.50); the database stores integer minor units (1250).
export const toMinor = (amount: number) => Math.round(amount * 100);
export const fromMinor = (minor: number) => minor / 100;

/** Shares must add up to the total exactly, or balances stop reconciling. */
export function sharesMatchTotal(totalMinor: number, sharesMinor: number[]) {
  return sharesMinor.reduce((sum, s) => sum + s, 0) === totalMinor;
}

export interface LedgerDelta {
  memberId: string;
  amountMinor: number;
}

/** Positive = should receive, negative = owes. Same convention as balances() in the UI. */
export function expenseDeltas(paidBy: string, amountMinor: number, shares: { memberId: string; amountMinor: number }[]): LedgerDelta[] {
  return [{ memberId: paidBy, amountMinor }, ...shares.map((s) => ({ memberId: s.memberId, amountMinor: -s.amountMinor }))];
}

export function settlementDeltas(from: string, to: string, amountMinor: number): LedgerDelta[] {
  return [
    { memberId: from, amountMinor },
    { memberId: to, amountMinor: -amountMinor },
  ];
}

/** Splits a total in proportion to weights by largest remainder: the parts always add up to it exactly. */
export function allocate(totalMinor: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalMinor : 0));
  const exact = weights.map((w) => (w / sum) * totalMinor);
  const parts = exact.map(Math.floor);
  const leftover = totalMinor - parts.reduce((s, p) => s + p, 0);
  const byRemainder = exact.map((e, i) => ({ i, rem: e - Math.floor(e) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; k < leftover; k++) parts[byRemainder[k % parts.length].i] += 1;
  return parts;
}

/** Each member's balance in the new currency. It nets to zero, so settled people stay exactly settled. */
export function convertedBalances(balances: Record<string, number>, rate: number): Record<string, number> {
  const ids = Object.keys(balances);
  const target = Object.fromEntries(ids.map((id) => [id, Math.round(balances[id] * rate)]));
  const off = ids.reduce((s, id) => s + target[id], 0);
  if (off !== 0 && ids.length) {
    const largest = ids.reduce((a, b) => (Math.abs(balances[b]) > Math.abs(balances[a]) ? b : a));
    target[largest] -= off;
  }
  return target;
}

/** Transfers that move each member from `actual` to `target`, given both net to zero. */
export function correctionTransfers(actual: Record<string, number>, target: Record<string, number>) {
  const ids = [...new Set([...Object.keys(actual), ...Object.keys(target)])].sort();
  const short = ids.map((id) => ({ id, amount: (target[id] ?? 0) - (actual[id] ?? 0) }));
  const receivers = short.filter((m) => m.amount > 0);
  const payers = short.filter((m) => m.amount < 0).map((m) => ({ id: m.id, amount: -m.amount }));
  const out: { from: string; to: string; amountMinor: number }[] = [];
  for (const receiver of receivers) {
    for (const payer of payers) {
      const amountMinor = Math.min(receiver.amount, payer.amount);
      if (amountMinor <= 0) continue;
      // A settlement credits `from` and debits `to`, so the member who's short is `from`.
      out.push({ from: receiver.id, to: payer.id, amountMinor });
      receiver.amount -= amountMinor;
      payer.amount -= amountMinor;
    }
  }
  return out;
}
