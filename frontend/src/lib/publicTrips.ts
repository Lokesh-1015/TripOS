// Public trips and requests to join them. Loaded on demand, separately from the app's main state.
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "./api";
import type { TravellerCard } from "./social";

export const TRIP_CATEGORIES = ["Adventure", "Backpacking", "Road trip", "Weekend getaway", "Trekking", "Beach", "Culture", "Food and experiences", "International"];
export const TRAVEL_STYLES = ["Adventure", "Mountains", "Beaches", "Food trails", "Heritage", "Road trips", "Backpacking", "Luxury", "Wellness"];

export interface PublicTrip {
  id: string;
  title: string;
  destination: string;
  cover: string;
  description: string;
  startDate: string;
  endDate: string;
  flexibleDates: boolean;
  days: number;
  category: string;
  travelStyle: string;
  participantCount: number;
  maxParticipants: number | null;
  placesLeft: number | null;
  full: boolean;
  budgetPerPerson: number | null;
  currency: string | null;
  plan: { day: number; title: string; type: string }[];
  host: { id: string | null; name: string; avatar: string; username: string | null };
}

export type ViewerState = "signed_out" | "host" | "member" | "invited" | "removed" | "pending" | "rejected" | "none";
export type PublicTripDetail = PublicTrip & { viewer: { state: ViewerState } };

export interface TripFilters {
  destination?: string;
  month?: string;
  from?: string;
  to?: string;
  budgetMax?: string;
  currency?: string;
  category?: string;
  style?: string;
  minDays?: string;
  maxDays?: string;
  minPeople?: string;
  maxPeople?: string;
  available?: string;
}

export interface JoinRequestRow {
  id: string;
  message: string;
  at: string;
  person: TravellerCard;
}

export interface JoinRequests {
  pending: JoinRequestRow[];
  accepted: JoinRequestRow[];
  rejected: JoinRequestRow[];
}

const KEY = "social";

export function usePublicTrips(filters: TripFilters) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  return useInfiniteQuery({
    queryKey: [KEY, "public-trips", params.toString()],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiGet<{ trips: PublicTrip[]; hasMore: boolean }>(`/public/trips?${params.toString()}&offset=${pageParam}`),
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.trips.length, 0) : undefined),
  });
}

export const usePublicTrip = (id: string) => useQuery({ queryKey: [KEY, "public-trip", id], queryFn: () => apiGet<PublicTripDetail>(`/public/trips/${id}`), retry: false });
export const useSuggestedTravellers = () => useQuery({ queryKey: [KEY, "suggested"], queryFn: () => apiGet<TravellerCard[]>("/people/suggested") });
export const useJoinRequests = (tripId: string, enabled: boolean) => useQuery({ queryKey: [KEY, "join-requests", tripId], queryFn: () => apiGet<JoinRequests>(`/trips/${tripId}/join-requests`), enabled });

export function useJoinActions() {
  const client = useQueryClient();
  const refreshing = <T,>(work: Promise<T>) => work.then(async (result) => {
    await client.invalidateQueries({ queryKey: [KEY] });
    return result;
  });
  return {
    request: (tripId: string, message: string) => refreshing(apiPost(`/public/trips/${tripId}/join-request`, { message })),
    cancel: (tripId: string) => refreshing(apiDelete(`/public/trips/${tripId}/join-request`)),
    accept: (tripId: string, id: string) => refreshing(apiPost(`/trips/${tripId}/join-requests/${id}/accept`)),
    reject: (tripId: string, id: string) => refreshing(apiPost(`/trips/${tripId}/join-requests/${id}/reject`)),
    reportTrip: (tripId: string, reason: string, details: string) => apiPost("/reports", { targetType: "trip", targetId: tripId, reason, details }),
  };
}
