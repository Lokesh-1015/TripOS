// Fetching exchange rates, with the provider replaced so the tests don't depend on it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RatesService } from "../src/rates/rates.service.js";

const providerRates = { INR: 95, USD: 1, EUR: 0.9, GBP: 0.75, AED: 3.67, SGD: 1.28, THB: 33.7, JPY: 157 };
const answer = (rates: Record<string, number> = providerRates) => new Response(JSON.stringify({ result: "success", time_last_update_unix: 1793577751, rates }));

describe("RatesService", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const quietly = () => {
    const service = new RatesService();
    vi.spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
    return service;
  };

  it("returns only the currencies TripOS offers, with the provider's update time", async () => {
    fetchMock.mockImplementation(async () => answer());
    const latest = await quietly().latest();
    expect(Object.keys(latest?.rates ?? {}).sort()).toEqual(["AED", "EUR", "GBP", "INR", "SGD", "THB", "USD"]);
    expect(latest).toMatchObject({ base: "USD", updatedAt: new Date(1793577751 * 1000).toISOString() });
  });

  it("asks the provider once, even for requests at the same moment, and caches the answer", async () => {
    fetchMock.mockImplementation(async () => answer());
    const service = quietly();
    await Promise.all([service.latest(), service.latest()]);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await service.latest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches again once the cached rates are old", async () => {
    fetchMock.mockImplementation(async () => answer());
    const service = quietly();
    await service.latest();
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    await service.latest();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the last rates while the provider is down, without hammering it", async () => {
    fetchMock.mockImplementationOnce(async () => answer());
    fetchMock.mockRejectedValue(new Error("provider down"));
    const service = quietly();
    const first = await service.latest();
    vi.setSystemTime(Date.now() + 7 * 60 * 60 * 1000);
    expect(await service.latest()).toEqual(first);
    expect(await service.latest()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("on a past date", () => {
    const history = () => new Response(JSON.stringify({ date: "2026-10-16", rates: { INR: 94.96, EUR: 0.88, GBP: 0.75, SGD: 1.28, THB: 33.4 } }));

    it("uses the day's real rates, says which day they're from, and adds the pegged dirham", async () => {
      fetchMock.mockImplementation(async () => history());
      const rates = await quietly().onDate("2026-10-17");
      expect(rates).toMatchObject({ date: "2026-10-16", base: "USD" });
      expect(rates?.rates).toEqual({ INR: 94.96, USD: 1, EUR: 0.88, GBP: 0.75, AED: 3.6725, SGD: 1.28, THB: 33.4 });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/2026-10-17?base=USD");
    });

    it("remembers a past day, as those rates never change", async () => {
      fetchMock.mockImplementation(async () => history());
      const service = quietly();
      await service.onDate("2026-10-17");
      await service.onDate("2026-10-17");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("uses the latest rates for today", async () => {
      fetchMock.mockImplementation(async () => answer());
      const today = new Date().toISOString().slice(0, 10);
      expect((await quietly().onDate(today))?.date).toBeUndefined();
    });

    it("reports a failure, and doesn't remember it", async () => {
      fetchMock.mockRejectedValueOnce(new Error("provider down"));
      fetchMock.mockImplementation(async () => history());
      const service = quietly();
      expect(await service.onDate("2026-10-17")).toBeNull();
      expect(await service.onDate("2026-10-17")).not.toBeNull();
    });
  });

  it("has nothing to offer if the provider has never answered", async () => {
    fetchMock.mockRejectedValue(new Error("provider down"));
    expect(await quietly().latest()).toBeNull();
  });

  it("rejects an answer that's missing a currency, rather than suggesting a wrong rate", async () => {
    const { THB: _dropped, ...partial } = providerRates;
    fetchMock.mockImplementation(async () => answer(partial));
    expect(await quietly().latest()).toBeNull();
  });
});
