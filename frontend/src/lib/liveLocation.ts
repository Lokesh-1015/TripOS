// Optional live location. Sharing is chosen per trip and ends by itself. Positions stay out of the app's
// main state, so they never reach the offline copy on this device.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPatch, apiPut } from "./api";
import { queryClient } from "./queryClient";

export interface LiveLocation {
  userId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  updatedAt: string;
  expiresAt: string;
}

export interface MyShare {
  tripId: string;
  expiresAt: string;
}

// Sending less often saves battery and the free database's compute hours.
const MIN_SEND_MS = 30_000;
const KEEP_ALIVE_MS = 5 * 60_000;
const MIN_MOVE_METERS = 50;
/** An update older than this is shown as "last seen" instead of live. */
export const STALE_AFTER_MS = 5 * 60_000;

export const liveLocationsKey = (tripId: string) => ["live-locations", tripId];
export const MY_SHARES_KEY = ["my-live-locations"];

export function useLiveLocations(tripId: string) {
  const { data } = useQuery({
    queryKey: liveLocationsKey(tripId),
    queryFn: () => apiGet<LiveLocation[]>(`/trips/${tripId}/live-locations`),
    // Sockets announce changes. This catches someone's share running out with nothing announcing it.
    refetchInterval: 60_000,
  });
  return (data ?? []).filter((x) => new Date(x.expiresAt).getTime() > Date.now());
}

export function useMyShares() {
  const { data } = useQuery({ queryKey: MY_SHARES_KEY, queryFn: () => apiGet<MyShare[]>("/live-locations/mine"), staleTime: 5 * 60_000 });
  return data ?? [];
}

const refresh = (tripId: string) => {
  void queryClient.invalidateQueries({ queryKey: MY_SHARES_KEY });
  void queryClient.invalidateQueries({ queryKey: liveLocationsKey(tripId) });
};

type Fix = { lat: number; lng: number; accuracy: number };
const toFix = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });

/** Asks the browser, which shows its own permission prompt the first time. */
function currentPosition() {
  return new Promise<Fix>((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser can't share its location."));
    navigator.geolocation.getCurrentPosition((p) => resolve(toFix(p)), (e) => reject(new Error(locationError(e))), { enableHighAccuracy: true, timeout: 15_000 });
  });
}

function locationError(e: GeolocationPositionError) {
  return e.code === e.PERMISSION_DENIED ? "Location access is blocked. Allow it for TripOS in your browser's settings to share." : "Your location couldn't be found. Please try again.";
}

export async function startSharing(tripId: string, hours: 1 | 4 | 8) {
  const fix = await currentPosition();
  await apiPut(`/trips/${tripId}/live-locations/me`, { ...fix, hours });
  refresh(tripId);
}

export async function stopSharing(tripId: string) {
  await apiDelete(`/trips/${tripId}/live-locations/me`);
  refresh(tripId);
}

function metersBetween(a: Fix, b: Fix) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Sends this device's position while a share is active, and stops the moment it ends. */
export function useSendPosition(tripId: string, expiresAt: string) {
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let last: Fix | null = null;
    let lastSent = 0;
    const end = () => refresh(tripId);
    const expiry = setTimeout(end, Math.max(0, new Date(expiresAt).getTime() - Date.now()) + 1000);
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const fix = toFix(p);
        const now = Date.now();
        const moved = !last || metersBetween(last, fix) >= MIN_MOVE_METERS;
        if (now - lastSent < (moved ? MIN_SEND_MS : KEEP_ALIVE_MS)) return;
        last = fix;
        lastSent = now;
        apiPatch(`/trips/${tripId}/live-locations/me`, fix).then(
          () => void queryClient.invalidateQueries({ queryKey: liveLocationsKey(tripId) }),
          (e) => {
            // Ended elsewhere, say on another device. A lost connection just tries again at the next position.
            if (e instanceof ApiError && (e.status === 403 || e.status === 404)) end();
          },
        );
      },
      (e) => {
        // With permission withdrawn, an old position would keep showing as if it were live.
        if (e.code === e.PERMISSION_DENIED) {
          toast.error(locationError(e));
          void stopSharing(tripId).catch(() => undefined);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => {
      clearTimeout(expiry);
      navigator.geolocation.clearWatch(watch);
    };
  }, [tripId, expiresAt]);
}
