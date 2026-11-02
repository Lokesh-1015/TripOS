// Searching for places, with the provider replaced so the tests don't depend on it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceSearchService } from "../src/places/place-search.service.js";

const GATEWAY = { geometry: { coordinates: [72.8347, 18.922] }, properties: { name: "Gateway of India", street: "Apollo Bandar", city: "Mumbai", state: "Maharashtra", country: "India" } };
const answer = (features: unknown[] = [GATEWAY]) => new Response(JSON.stringify({ features }));

describe("PlaceSearchService", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const quietly = () => {
    const service = new PlaceSearchService();
    vi.spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
    return service;
  };

  it("turns the provider's answer into a name, address and coordinates", async () => {
    fetchMock.mockImplementation(async () => answer());
    expect(await quietly().search("gateway")).toEqual([{ name: "Gateway of India", address: "Apollo Bandar, Mumbai, Maharashtra, India", lat: 18.922, lng: 72.8347 }]);
  });

  it("passes on what's searched for and where, identifies itself, and nothing about the person", async () => {
    fetchMock.mockImplementation(async () => answer());
    await quietly().search("chai", { lat: 18.9, lng: 72.8 });
    const [url, init] = fetchMock.mock.calls[0];
    const params = (url as URL).searchParams;
    expect(params.get("q")).toBe("chai");
    expect(params.get("lat")).toBe("18.9");
    expect(params.get("lon")).toBe("72.8");
    expect(Object.keys(init?.headers as object)).toEqual(["User-Agent"]);
  });

  it("asks the provider once for a repeated search, whatever the capitalisation", async () => {
    fetchMock.mockImplementation(async () => answer());
    const service = quietly();
    await service.search("Goa");
    await service.search("goa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips results with no coordinates or name", async () => {
    fetchMock.mockImplementation(async () => answer([{ properties: { name: "Nowhere" } }, { geometry: { coordinates: [1, 2] }, properties: {} }, GATEWAY]));
    expect(await quietly().search("x y")).toHaveLength(1);
  });

  it("reports a failure rather than pretending nothing matched, and doesn't remember it", async () => {
    fetchMock.mockRejectedValueOnce(new Error("provider down"));
    fetchMock.mockImplementation(async () => answer());
    const service = quietly();
    expect(await service.search("goa")).toBeNull();
    expect(await service.search("goa")).toHaveLength(1);
  });
});
