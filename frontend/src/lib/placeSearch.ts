// Finding places through Photon, an OpenStreetMap search service. The browser calls it directly: it's built
// for that, and it refuses connections from our hosting provider's servers.
const SEARCH_URL = "https://photon.komoot.io/api/";
const RESULTS = 5;
const TIMEOUT_MS = 8_000;

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

/** Matching places, nearest to `near` first. Throws if the service can't be reached. */
export async function searchPlaces(query: string, near?: { lat: number; lng: number }): Promise<PlaceResult[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(RESULTS));
  if (near) {
    url.searchParams.set("lat", String(near.lat));
    url.searchParams.set("lon", String(near.lng));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Place search answered ${res.status}`);
  const body = (await res.json()) as { features?: PhotonFeature[] };
  return (body.features ?? []).map(toResult).filter((r): r is PlaceResult => r !== null);
}
