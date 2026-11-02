// Exchange rates for suggesting a rate and adding up across currencies. What an expense counts as is
// always the rate saved with it, so a new day's rates never change anyone's balance.
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import { money } from "./format";

export interface ExchangeRates {
  base: string;
  /** How much 1 unit of the base buys in each currency. */
  rates: Record<string, number>;
  updatedAt: string;
  /** For past rates: the day they're from, which can be a little before the day asked for, as markets close at weekends. */
  date?: string;
}

const STORAGE_KEY = "tripos:exchange-rates";
const FRESH_MS = 6 * 60 * 60 * 1000;

// Kept on this device so totals and suggestions still work offline.
function storedRates(): ExchangeRates | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExchangeRates) : undefined;
  } catch {
    return undefined;
  }
}

/** Today's rates, or a past date's if one is given. */
export function useExchangeRates(date?: string) {
  return useQuery({
    queryKey: ["exchange-rates", date ?? "latest"],
    queryFn: async () => {
      if (date) return apiGet<ExchangeRates>(`/exchange-rates?date=${date}`);
      const rates = await apiGet<ExchangeRates>("/exchange-rates");
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rates));
      } catch {
        /* Storage is full or blocked: rates are just fetched again next time */
      }
      return rates;
    },
    initialData: date ? undefined : storedRates,
    initialDataUpdatedAt: date ? undefined : 0,
    // A past day's rates never change.
    staleTime: date ? Infinity : FRESH_MS,
    retry: 1,
  });
}

/** What 1 unit of `from` is worth in `to`, or null when either rate is unknown. */
export function rateBetween(rates: ExchangeRates | undefined, from: string, to: string): number | null {
  if (from === to) return 1;
  const a = rates?.rates[from];
  const b = rates?.rates[to];
  if (!a || !b) return null;
  return Number((b / a).toPrecision(6));
}

/** Adds up amounts in different currencies, or lists them by currency when there's no rate to convert with. */
export function sumAcross(items: { amount: number; currency: string }[], target: string, rates: ExchangeRates | undefined) {
  const byCurrency = new Map<string, number>();
  for (const { amount, currency } of items) byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  const converted = [...byCurrency.keys()].some((currency) => currency !== target);
  const all = [...byCurrency].map(([currency, amount]) => ({ amount, currency, rate: rateBetween(rates, currency, target) }));
  if (all.some((x) => x.rate === null)) {
    return { text: all.map((x) => money(Math.round(x.amount * 100) / 100, x.currency)).join(" + "), converted: false, unavailable: true };
  }
  const total = all.reduce((sum, x) => sum + x.amount * (x.rate as number), 0);
  return { text: money(Math.round(total * 100) / 100, target), converted, unavailable: false };
}
