import { Injectable, Logger } from "@nestjs/common";

const SEARCH_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "TripOS (https://tripos-travel.vercel.app)";
const RESULTS = 5;
const TIMEOUT_MS = 5_000;
// Photon asks for fair use, and the same searches come up often, so answers are kept for a day.
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_SIZE = 500;

export interface PlaceResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

function toResult(feature: PhotonFeature): PlaceResult | null {
  const [lng, lat] = feature.geometry?.coordinates ?? [];
  const p = feature.properties ?? {};
  const name = p.name ?? p.street ?? p.city;
  if (typeof lat !== "number" || typeof lng !== "number" || !name) return null;
  const street = p.street && p.housenumber ? `${p.housenumber} ${p.street}` : p.street;
  const parts = [street, p.district, p.city, p.state, p.country].filter((part): part is string => !!part && part !== name);
  return { name, address: [...new Set(parts)].join(", "), lat, lng };
}

/** Searches go through here rather than from the browser, so the provider never sees who is searching. */
@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);
  private readonly cache = new Map<string, { at: number; results: PlaceResult[] }>();

  /** Matching places, or null if the provider can't be reached. */
  async search(query: string, near?: { lat: number; lng: number }): Promise<PlaceResult[] | null> {
    const key = `${query.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ""}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.results;

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(RESULTS));
    if (near) {
      url.searchParams.set("lat", String(near.lat));
      url.searchParams.set("lon", String(near.lng));
    }
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`The place search answered ${res.status}`);
      const body = (await res.json()) as { features?: PhotonFeature[] };
      const results = (body.features ?? []).map(toResult).filter((r): r is PlaceResult => r !== null);
      if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, { at: Date.now(), results });
      return results;
    } catch (err) {
      this.logger.warn(`Place search failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
