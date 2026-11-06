// Traveller profiles and friends. Loaded separately from the app's main state, so trips stay as fast as they were.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";

export type Relationship = "self" | "none" | "request_sent" | "request_received" | "friends";

export interface TravellerCard {
  id: string;
  username: string;
  name: string;
  avatar: string;
  relationship: Relationship;
  requestId?: string;
  canSendRequest: boolean;
  /** A private profile, seen by someone who isn't a friend. */
  limited: boolean;
  location: string;
  travelStyles: string[];
  sharedStyles: string[];
  sharedInterests: string[];
  sharedDestinations: string[];
  mutualFriends: number;
}

export interface TravellerProfile extends TravellerCard {
  visibility: "public" | "private";
  bio: string;
  coverPhoto: string;
  interests: string[];
  favouriteDestinations: string[];
  placesVisited: string[];
}

export interface OwnProfile extends TravellerProfile {
  friendRequestsFrom: "everyone" | "nobody";
  emailVerified: boolean;
  isAdmin: boolean;
}

export interface FriendRequest {
  id: string;
  at: string;
  person: TravellerCard;
}

export interface FriendRequests {
  incoming: FriendRequest[];
  sent: FriendRequest[];
  declined: FriendRequest[];
}

export interface BlockedPerson {
  id: string;
  name: string;
  avatar: string;
  username: string | null;
}

export interface ReportRow {
  id: string;
  targetType: "profile" | "trip" | "post";
  trip?: { id: string; name: string; isPublic: boolean };
  post?: { id: string; exists: boolean; caption: string; author: string };
  reason: string;
  details: string;
  status: "open" | "reviewed";
  at: string;
  reporter: string;
  target: { id: string; name: string; username: string | null; suspended: boolean };
}

const KEY = "social";
export const useOwnProfile = () => useQuery({ queryKey: [KEY, "me"], queryFn: () => apiGet<OwnProfile>("/me/profile") });
export const useProfile = (username: string) => useQuery({ queryKey: [KEY, "profile", username.toLowerCase()], queryFn: () => apiGet<TravellerProfile>(`/profiles/${encodeURIComponent(username)}`), retry: false });
export const useFriends = () => useQuery({ queryKey: [KEY, "friends"], queryFn: () => apiGet<TravellerCard[]>("/friends") });
export const useFriendRequests = () => useQuery({ queryKey: [KEY, "requests"], queryFn: () => apiGet<FriendRequests>("/friends/requests") });
export const useBlocked = () => useQuery({ queryKey: [KEY, "blocks"], queryFn: () => apiGet<BlockedPerson[]>("/blocks") });
export const usePeopleSearch = (q: string) => useQuery({ queryKey: [KEY, "search", q], queryFn: () => apiGet<TravellerCard[]>(`/people/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
export const useAdminReports = () => useQuery({ queryKey: [KEY, "reports"], queryFn: () => apiGet<ReportRow[]>("/admin/reports"), retry: false });

export interface ProfilePatch {
  username?: string;
  location?: string;
  coverPhoto?: string;
  interests?: string[];
  favouriteDestinations?: string[];
  placesVisited?: string[];
  profileVisibility?: "public" | "private";
  friendRequestsFrom?: "everyone" | "nobody";
}

/** The actions, each refreshing whatever it might have changed. */
export function useSocialActions() {
  const client = useQueryClient();
  const refreshing = <T,>(work: Promise<T>) => work.then(async (result) => {
    await client.invalidateQueries({ queryKey: [KEY] });
    return result;
  });
  return {
    updateProfile: (patch: ProfilePatch) => refreshing(apiPatch<OwnProfile>("/me/profile", patch)),
    refresh: () => client.invalidateQueries({ queryKey: [KEY] }),
    sendRequest: (username: string) => refreshing(apiPost("/friends/requests", { username })),
    accept: (id: string) => refreshing(apiPost(`/friends/requests/${id}/accept`)),
    decline: (id: string) => refreshing(apiPost(`/friends/requests/${id}/decline`)),
    cancel: (id: string) => refreshing(apiDelete(`/friends/requests/${id}`)),
    removeFriend: (userId: string) => refreshing(apiDelete(`/friends/${userId}`)),
    block: (userId: string) => refreshing(apiPost("/blocks", { userId })),
    unblock: (userId: string) => refreshing(apiDelete(`/blocks/${userId}`)),
    report: (targetId: string, reason: string, details: string) => apiPost("/reports", { targetType: "profile", targetId, reason, details }),
    reviewReport: (id: string) => refreshing(apiPost(`/admin/reports/${id}/review`)),
    removePost: (postId: string) => refreshing(apiPost(`/admin/posts/${postId}/remove`)),
    unpublishTrip: (tripId: string) => refreshing(apiPost(`/admin/trips/${tripId}/unpublish`)),
    suspend: (userId: string) => refreshing(apiPost(`/admin/users/${userId}/suspend`)),
    unsuspend: (userId: string) => refreshing(apiPost(`/admin/users/${userId}/unsuspend`)),
  };
}
