// Checks and orderings worked out from a trip's plan.
import type { Activity, Place, Trip } from "./types";

/** Other plans on the same day that overlap this one. Free time doesn't clash with anything. */
export function overlapsWith(activity: Pick<Activity, "id" | "day" | "start" | "end" | "type">, activities: Activity[]) {
  if (activity.type === "free") return [];
  return activities.filter((other) => other.id !== activity.id && other.day === activity.day && other.type !== "free" && activity.start < other.end && other.start < activity.end);
}

/** Saved places in the order the itinerary visits them, or in saved order if nothing is linked yet. */
export function routeStops(trip: Pick<Trip, "activities" | "places">): { stops: Place[]; followsItinerary: boolean } {
  const ordered = [...trip.activities].sort((a, b) => a.day - b.day);
  const stops: Place[] = [];
  for (const activity of ordered) {
    const place = trip.places.find((p) => p.id === activity.placeId);
    if (place && !stops.includes(place)) stops.push(place);
  }
  return stops.length ? { stops, followsItinerary: true } : { stops: trip.places, followsItinerary: false };
}
