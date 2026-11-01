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
