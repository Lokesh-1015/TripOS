import { Injectable, Logger } from "@nestjs/common";

const RATES_URL = "https://open.er-api.com/v6/latest/USD";
// The same list as the currency pickers in the frontend.
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "THB"];
// The provider updates once a day and asks callers to cache.
const FRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8_000;
// Past rates come from the European Central Bank through Frankfurter, as the daily provider keeps no history.
const HISTORY_URL = "https://api.frankfurter.dev/v1";
// The ECB doesn't publish the dirham, which has been pegged to the US dollar at this rate since 1997.
const AED_PER_USD = 3.6725;
const HISTORY_CACHE_SIZE = 1000;

export interface ExchangeRates {
  base: "USD";
  /** How much 1 USD buys in each currency. */
  rates: Record<string, number>;
  updatedAt: string;
  /** For past rates: the day they're from. Markets close at weekends, so this can be a little earlier than asked. */
  date?: string;
}

const asOf = (date: string) => `${date}T00:00:00.000Z`;

/** Suggested rates only: what an expense counts as is always the rate saved with it, so balances never move. */
@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private cached: ExchangeRates | null = null;
  private fetchedAt = 0;
  private failedAt = 0;
  private request: Promise<ExchangeRates | null> | null = null;
  // A past day's rates never change, so they're kept for as long as there's room.
  private readonly history = new Map<string, ExchangeRates>();

  /** The latest rates, an older copy if the provider is down, or null if there's never been an answer. */
  latest(): Promise<ExchangeRates | null> {
    const now = Date.now();
    if (now - this.fetchedAt < FRESH_MS || now - this.failedAt < RETRY_AFTER_FAILURE_MS) return Promise.resolve(this.cached);
    this.request ??= this.fetchRates().finally(() => {
      this.request = null;
    });
    return this.request;
  }

  /** The rates on a past date. Today or later gives the latest. Null if they aren't available. */
  async onDate(date: string): Promise<ExchangeRates | null> {
    if (date >= new Date().toISOString().slice(0, 10)) return this.latest();
    const cached = this.history.get(date);
    if (cached) return cached;
    try {
      const symbols = CURRENCIES.filter((c) => c !== "USD" && c !== "AED").join(",");
      const res = await fetch(`${HISTORY_URL}/${date}?base=USD&symbols=${symbols}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`The history provider answered ${res.status}`);
      const body = (await res.json()) as { date?: string; rates?: Record<string, unknown> };
      const rates: Record<string, number> = { USD: 1, AED: AED_PER_USD };
      for (const code of CURRENCIES) {
        const rate = rates[code] ?? body.rates?.[code];
        if (typeof rate !== "number" || !(rate > 0)) throw new Error(`The history provider has no rate for ${code}`);
        rates[code] = rate;
      }
      const result: ExchangeRates = { base: "USD", rates, updatedAt: asOf(body.date ?? date), date: body.date ?? date };
      if (this.history.size >= HISTORY_CACHE_SIZE) this.history.delete(this.history.keys().next().value as string);
      this.history.set(date, result);
      return result;
    } catch (err) {
      this.logger.warn(`Could not fetch rates for ${date}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async fetchRates() {
    try {
      const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`The rate provider answered ${res.status}`);
      const body = (await res.json()) as { result?: string; rates?: Record<string, unknown>; time_last_update_unix?: number };
      if (body.result !== "success" || !body.rates) throw new Error("The rate provider sent an unexpected answer");
      const rates: Record<string, number> = {};
      for (const code of CURRENCIES) {
        const rate = body.rates[code];
        if (typeof rate !== "number" || !(rate > 0)) throw new Error(`The rate provider has no rate for ${code}`);
        rates[code] = rate;
      }
      const updated = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : new Date();
      this.cached = { base: "USD", rates, updatedAt: updated.toISOString() };
      this.fetchedAt = Date.now();
      this.failedAt = 0;
    } catch (err) {
      this.failedAt = Date.now();
      this.logger.warn(`Could not fetch exchange rates: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.cached;
  }
}
