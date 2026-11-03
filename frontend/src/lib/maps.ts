/**
 * A link that opens this exact place in Google Maps: the app on a phone that has it, the website otherwise.
 * Coordinates are used when we have them, as a name alone could match somewhere else.
 */
export function googleMapsUrl(place: { name: string; address?: string; lat?: number | null; lng?: number | null }) {
  const query = place.lat != null && place.lng != null ? `${place.lat},${place.lng}` : [place.name, place.address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
