// The app's data layer: screens read through useApp and write through actions, exactly as they did
// when this was local-only. State now comes from the API, writes apply optimistically and then
// reconcile, and Socket.IO keeps every connected member's copy current.
import { useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import type { AppNotification, AppState, Person, Settings, Trip, TripCollection, TripEvent } from "./types";
import { apiDelete, apiErrorMessage, ApiError, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { clearOfflineCopy, readOfflineCopy, saveOfflineCopy } from "./offline";
import { queryClient } from "./queryClient";
import { LATEST_RELEASE } from "./releaseNotes";
import { beginSession, endSession } from "./session";
import { uid } from "./format";

const NEXT = "tripos:next";
const SIGNED_OUT_USER: Person = { id: "", name: "", email: "", avatar: "" };
const DEFAULT_SETTINGS: Settings = {
  currency: "INR",
  bio: "",
  travelStyles: [],
  notify: {},
  privacy: { profilePublic: true, showEmail: false, shareLocation: true },
};

let state: AppState = { version: 1, loading: true, offline: false, offlineCopy: false, authed: false, emailVerified: false, mustConfirmEmail: false, hasPassword: true, emailEnabled: true, onboarded: false, user: SIGNED_OUT_USER, settings: DEFAULT_SETTINGS, saved: [], trips: [], notifications: [] };
const listeners = new Set<() => void>();

let offlineCopyTimer: ReturnType<typeof setTimeout> | undefined;

function set(next: AppState) {
  state = next;
  listeners.forEach((l) => l());
  clearTimeout(offlineCopyTimer);
  if (next.authed && !next.loading) {
    offlineCopyTimer = setTimeout(() => {
      const { loading: _loading, offline: _offline, offlineCopy: _offlineCopy, ...copy } = state;
      void saveOfflineCopy(copy);
    }, 1000);
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

// Snapshot is the (stable) root state; the selector runs during render so derived arrays are safe.
export function useApp<T>(selector: (s: AppState) => T): T {
  const s = useSyncExternalStore(subscribe, () => state);
  return selector(s);
}

export const getState = () => state;
export const useTrip = (id: string | undefined) => useApp((s) => s.trips.find((t) => t.id === id));

export function rememberNext(path: string) {
  sessionStorage.setItem(NEXT, path);
}
/** The same place as takeNext, for a screen that may be left again, without using it up. */
export const peekNext = (fallback = "/app") => sessionStorage.getItem(NEXT) || fallback;
export function takeNext(fallback = "/app") {
  const n = sessionStorage.getItem(NEXT);
  sessionStorage.removeItem(NEXT);
  return n || fallback;
}

/** The "anyone with the link" URL. Only people who can invite receive the code. */
export const inviteLink = (trip: Trip) => (trip.joinCode ? `${window.location.origin}/join/${trip.joinCode}` : null);

// --- Loading and live updates ---------------------------------------------------------------

type ServerState = Omit<AppState, "loading" | "offlineCopy" | "authed"> & { authed: true };

let socket: Socket | null = null;

function connectSocket() {
  if (socket) return;
  // Vercel can't carry a socket, so in production this connects straight to the API host. The login cookie
  // belongs to the frontend's domain, so each connection proves itself with a short-lived ticket instead.
  socket = io(import.meta.env.VITE_SOCKET_URL || window.location.origin, {
    path: "/api/socket.io",
    transports: ["websocket", "polling"],
    auth: (send) => {
      apiGet<{ ticket: string }>("/auth/realtime-ticket").then(({ ticket }) => send({ ticket }), () => send({}));
    },
  });
  socket.on("trip:changed", ({ tripId }: { tripId: string }) => void refreshTrip(tripId));
  socket.on("trips:changed", () => void loadState());
  socket.on("notifications:changed", () => void refreshNotifications());
  socket.on("locations:changed", ({ tripId }: { tripId: string }) => void queryClient.invalidateQueries({ queryKey: ["live-locations", tripId] }));
  socket.on("connect", () => setOffline(false));
  socket.on("disconnect", (reason) => {
    setOffline(true);
    // The server turned this connection away (say the ticket couldn't be fetched while it woke up). Socket.IO
    // doesn't retry that by itself.
    if (reason === "io server disconnect") setTimeout(() => socket?.connect(), 3000);
  });
  // The server says "ready" once this connection has joined its rooms, on every connect and reconnect.
  // Reloading then picks up anything that changed before the socket was listening.
  socket.on("ready", () => void loadState());
}

function disconnectSocket() {
  socket?.close();
  socket = null;
}

// The free backend sleeps when idle and can take about a minute to wake. Until it answers, nobody knows whether this
// person is signed in, so the app waits rather than sending them to the login page as if their session had ended.
const WAKE_RETRY_MS = 3000;
const WAKE_RETRIES = 40;
let wakeRetries = 0;

/** Waits until the server is answering, so the first thing someone submits isn't lost to it waking up. */
async function waitForServer() {
  for (let i = 0; i < WAKE_RETRIES; i++) {
    const ok = await fetch("/api/health").then((r) => r.ok, () => false);
    if (ok || navigator.onLine === false) return;
    await sleep(WAKE_RETRY_MS);
  }
}

let stateRequest = 0;
let stateLoading = false;

export async function loadState() {
  // Queued writes are still only on this screen, so a full reload now would wipe them. Do it after they land.
  if (pending.size) return void (reloadAfterWrites = true);
  const request = ++stateRequest;
  stateLoading = true;
  try {
    const server = await apiGet<ServerState>("/state");
    if (request !== stateRequest) return;
    stateLoading = false;
    tripRequests.clear();
    wakeRetries = 0;
    set({ ...server, loading: false, waking: false, offline: state.offline, offlineCopy: false, authed: true });
    connectSocket();
  } catch (e) {
    if (request !== stateRequest) return;
    stateLoading = false;
    if (e instanceof ApiError && e.status === 401) {
      disconnectSocket();
      void clearOfflineCopy();
      wakeRetries = 0;
      set({ ...state, loading: false, waking: false, authed: false, onboarded: false, user: SIGNED_OUT_USER, trips: [], notifications: [], saved: [] });
    } else {
      // The API is unreachable: keep what's on screen and let the socket's reconnect retry.
      // Opening the app with no signal has nothing on screen yet, so it uses the copy on this device.
      const copy = state.authed ? undefined : await readOfflineCopy();
      if (request !== stateRequest) return;
      if (copy) {
        set({ ...copy, loading: false, offline: true, offlineCopy: true });
        connectSocket();
      } else if (!state.authed && e instanceof ApiError && wakeRetries < WAKE_RETRIES) {
        // An error from the host means the server is still waking. No answer at all means this device is offline, so waiting wouldn't help.
        wakeRetries++;
        set({ ...state, loading: true, waking: true });
        setTimeout(() => void loadState(), WAKE_RETRY_MS);
      } else {
        set({ ...state, loading: false, waking: false });
      }
    }
  }
}

const tripRequests = new Map<string, number>();

async function refreshTrip(tripId: string) {
  // A write is still in flight: its completion refreshes, so optimistic state isn't overwritten now.
  if (pending.has(tripId)) return;
  const request = (tripRequests.get(tripId) ?? 0) + 1;
  tripRequests.set(tripId, request);
  try {
    const trip = await apiGet<Trip>(`/trips/${tripId}`);
    if (tripRequests.get(tripId) !== request || pending.has(tripId)) return;
    const known = state.trips.some((t) => t.id === tripId);
    set({ ...state, trips: known ? state.trips.map((t) => (t.id === tripId ? trip : t)) : [...state.trips, trip] });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
      set({ ...state, trips: state.trips.filter((t) => t.id !== tripId) });
    }
  }
}

async function refreshNotifications() {
  try {
    const notifications = await apiGet<AppNotification[]>("/notifications");
    set({ ...state, notifications });
  } catch {
    /* the next event or reconnect refreshes this */
  }
}

// --- Writes -----------------------------------------------------------------------------------

// Each trip's writes go out one at a time and in order, so a quick double-click can't race itself.
const pending = new Map<string, number>();
const queues = new Map<string, Promise<boolean>>();
let reloadAfterWrites = false;

function setOffline(offline: boolean) {
  if (state.offline !== offline) set({ ...state, offline });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** No answer from the server, as opposed to the server refusing the change. */
function isUnreachable(e: unknown) {
  return !(e instanceof ApiError) || (e.status >= 500 && !(e.body as { message?: unknown } | null)?.message);
}

/**
 * A lost connection doesn't lose the change: it's retried until the server answers, and client-made
 * ids make the retries safe. A refusal from the server is final and comes back as an error.
 */
async function untilAnswered(request: () => Promise<unknown>) {
  for (let delay = 500; ; delay = Math.min(delay * 2, 4000)) {
    try {
      await request();
      setOffline(false);
      return;
    } catch (e) {
      if (!isUnreachable(e)) throw e;
      setOffline(true);
      await sleep(delay);
    }
  }
}

// What the most recent action resolved to, read by saved() below.
let lastWrite: Promise<boolean> = Promise.resolve(true);

/** Call straight after an action: confirms it to the user only once the server has accepted it. */
export function saved(message: string, options?: { description?: string }) {
  void lastWrite.then((ok) => {
    if (ok) toast.success(message, options);
  });
}

function send(tripId: string, request: () => Promise<unknown>) {
  // A reload already on its way predates this write and would undo it on screen: drop it and reload afterwards.
  if (stateLoading) {
    stateRequest++;
    stateLoading = false;
    reloadAfterWrites = true;
  }
  pending.set(tripId, (pending.get(tripId) ?? 0) + 1);
  const done = (queues.get(tripId) ?? Promise.resolve(true))
    .then(() => untilAnswered(request))
    .then(
      () => true,
      (e) => {
        toast.error(apiErrorMessage(e));
        return false;
      },
    )
    .finally(() => {
      const left = (pending.get(tripId) ?? 1) - 1;
      if (left > 0) return void pending.set(tripId, left);
      pending.delete(tripId);
      queues.delete(tripId);
      // Always reconcile with the server once this trip's queue drains.
      void refreshTrip(tripId);
      if (reloadAfterWrites && !pending.size) {
        reloadAfterWrites = false;
        void loadState();
      }
    });
  queues.set(tripId, done);
  lastWrite = done;
  return done;
}

// The newest version this client has written, so a second quick edit isn't refused as stale. An item
// someone else has since changed carries a higher version, so a real conflict is still caught.
const acked = new Map<string, number>();

function sendVersioned(tripId: string, itemId: string, version: number | undefined, request: (expected: number | undefined) => Promise<unknown>) {
  return send(tripId, async () => {
    const expected = version === undefined ? undefined : Math.max(version, acked.get(itemId) ?? 0);
    await request(expected);
    if (expected !== undefined) acked.set(itemId, expected + 1);
  });
}

// The browser knows it's offline before a socket does, and an open socket can outlive the connection.
window.addEventListener("offline", () => setOffline(true));
window.addEventListener("online", () => {
  setOffline(false);
  if (state.offlineCopy || !state.authed) void loadState();
});

// Leaving with changes still waiting for a connection would lose them.
window.addEventListener("beforeunload", (e) => {
  if (pending.size) e.preventDefault();
});

type Item<K extends TripCollection> = Trip[K][number];

const PATHS: Partial<Record<TripCollection, string>> = {
  activities: "activities",
  expenses: "expenses",
  settlements: "settlements",
  tasks: "tasks",
  packing: "packing",
  documents: "documents",
  places: "places",
  messages: "messages",
  polls: "polls",
  photos: "photos",
};

function mapTrip(tripId: string, fn: (t: Trip) => Trip) {
  set({ ...state, trips: state.trips.map((t) => (t.id === tripId ? fn(t) : t)) });
}

/** Shown immediately; the feed line the server wrote replaces it on the next refresh. */
function event(text: string, kind: string): TripEvent {
  return { id: uid("ev"), actorId: state.user.id, text, at: new Date().toISOString(), kind };
}

/** A reload that started before this write would undo it on screen, so replace it with a fresh one. */
function supersedeStaleLoad() {
  if (stateLoading) void loadState();
}

function saveUser(patch: Record<string, unknown>) {
  lastWrite = apiPatch("/me", patch).then(
    () => {
      supersedeStaleLoad();
      return true;
    },
    (e) => {
      toast.error(apiErrorMessage(e));
      void loadState();
      return false;
    },
  );
  return lastWrite;
}

export const actions = {
  async signIn(email: string, password: string) {
    await waitForServer();
    await apiPost("/auth/login", { email, password });
    beginSession();
    await loadState();
  },
  async signInWithGoogle(credential: string) {
    await waitForServer();
    await apiPost("/auth/google", { credential });
    beginSession();
    await loadState();
  },
  /** Fixes a typo in an address that hasn't been confirmed yet, which sends the email again. */
  async changeUnconfirmedEmail(email: string) {
    await apiPatch("/me", { email });
    await loadState();
  },
  async signUp(name: string, email: string, password: string) {
    await waitForServer();
    await apiPost("/auth/signup", { name, email, password });
    beginSession();
    await loadState();
  },
  forgotPassword: (email: string) => apiPost<{ emailEnabled: boolean }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => apiPost("/auth/reset-password", { token, password }),
  changePassword: (current: string, next: string) => apiPost("/auth/change-password", { current, next }),
  verifyEmail: async (token: string) => {
    await apiPost("/auth/verify-email", { token });
    await loadState();
  },
  resendVerification: () => apiPost("/auth/resend-verification"),
  reload: () => loadState(),
  async finishOnboarding(patch: { name: string; bio: string; currency: string; travelStyles: string[] }) {
    // Someone joining now has nothing to catch up on, so they start with the latest release marked as seen.
    await apiPatch("/me", { ...patch, onboarded: true, seenReleaseNotes: LATEST_RELEASE.id });
    // Apply this now: a reload may be overlapping (the live connection triggers one), and whichever
    // loses gives up without waiting, so the next screen can't rely on awaiting it.
    set({
      ...state,
      onboarded: true,
      seenReleaseNotes: LATEST_RELEASE.id,
      user: { ...state.user, name: patch.name },
      settings: { ...state.settings, bio: patch.bio, currency: patch.currency, travelStyles: patch.travelStyles },
    });
    void loadState();
  },
  async signOut() {
    disconnectSocket();
    clearTimeout(offlineCopyTimer);
    await clearOfflineCopy();
    // Nothing on this device can keep a position up to date after this, so sharing stops too.
    await apiDelete("/live-locations/mine").catch(() => undefined);
    return endSession("/login");
  },
  /** Starts a new trip from an existing one. Returns the new trip's id. */
  async copyTrip(tripId: string, input: { id: string; name: string; startDate: string }) {
    const trip = await apiPost<Trip>(`/trips/${tripId}/copy`, input);
    set({ ...state, trips: [...state.trips.filter((t) => t.id !== trip.id), trip] });
    return trip.id;
  },
  /** Join through an invite link. Returns the trip's id. */
  async joinTrip(code: string) {
    const trip = await apiPost<Trip>(`/invites/${code}/accept`);
    set({ ...state, trips: [...state.trips.filter((t) => t.id !== trip.id), trip] });
    return trip.id;
  },
  updateProfile(patch: { name?: string; email?: string; avatar?: string }) {
    const user = { ...state.user, ...patch };
    const emailChanged = !!patch.email && patch.email.trim().toLowerCase() !== state.user.email;
    set({ ...state, user, emailVerified: emailChanged ? false : state.emailVerified, trips: state.trips.map((t) => ({ ...t, members: t.members.map((m) => (m.id === user.id ? { ...m, ...patch } : m)) })) });
    return saveUser(patch);
  },
  /** Quiet if it fails: the worst that happens is seeing the release notes once more. */
  markReleaseNotesSeen(id: string) {
    set({ ...state, seenReleaseNotes: id });
    void apiPatch("/me", { seenReleaseNotes: id }).then(supersedeStaleLoad, () => undefined);
  },
  updateSettings(patch: Partial<Settings>) {
    set({ ...state, settings: { ...state.settings, ...patch } });
    return saveUser(patch);
  },
  setSaved(saved: string[]) {
    set({ ...state, saved });
    lastWrite = apiPut("/me/saved", { saved }).then(
      () => {
        supersedeStaleLoad();
        return true;
      },
      (e) => {
        toast.error(apiErrorMessage(e));
        void loadState();
        return false;
      },
    );
  },

  createTrip(trip: Trip) {
    set({ ...state, trips: [trip, ...state.trips] });
    const members = trip.members.filter((m) => m.id !== state.user.id).map((m) => (m.email ? { email: m.email } : { id: m.id }));
    return send(trip.id, () => apiPost("/trips", { ...trip, members }));
  },
  patchTrip(tripId: string, patch: Partial<Trip>, log?: string) {
    const version = state.trips.find((t) => t.id === tripId)?.version;
    mapTrip(tripId, (t) => ({ ...t, ...patch, events: log ? [event(log, "trip"), ...t.events] : t.events }));
    void sendVersioned(tripId, tripId, version, (expected) => apiPatch(`/trips/${tripId}`, { ...patch, version: expected }));
  },
  deleteTrip(tripId: string) {
    set({ ...state, trips: state.trips.filter((t) => t.id !== tripId), notifications: state.notifications.filter((n) => n.tripId !== tripId) });
    lastWrite = apiDelete(`/trips/${tripId}`).then(
      () => true,
      (e) => {
        toast.error(apiErrorMessage(e));
        void loadState();
        return false;
      },
    );
  },
  /** Insert or replace a record in a trip collection. The server writes the real activity feed line. */
  upsert<K extends TripCollection>(tripId: string, key: K, item: Item<K>, log?: { text: string; kind: string }, prepend = false) {
    const trip = state.trips.find((t) => t.id === tripId);
    const list = (trip?.[key] ?? []) as Item<K>[];
    const exists = list.some((x) => x.id === item.id);
    mapTrip(tripId, (t) => {
      const next = exists ? list.map((x) => (x.id === item.id ? item : x)) : prepend ? [item, ...list] : [...list, item];
      return { ...t, [key]: next, events: log ? [event(log.text, log.kind), ...t.events] : t.events };
    });
    if (key === "members") {
      const m = item as Item<"members">;
      void send(tripId, () => (exists ? apiPatch(`/trips/${tripId}/members/${m.id}`, { role: m.role }) : apiPost(`/trips/${tripId}/members`, { email: m.email })));
      return;
    }
    const path = `/trips/${tripId}/${PATHS[key]}/${item.id}`;
    const version = (item as { version?: number }).version;
    void sendVersioned(tripId, item.id, version, (expected) => apiPut(path, { ...item, version: expected }));
  },
  remove<K extends TripCollection>(tripId: string, key: K, id: string, log?: { text: string; kind: string }) {
    mapTrip(tripId, (t) => ({
      ...t,
      [key]: (t[key] as Item<K>[]).filter((x) => x.id !== id),
      events: log ? [event(log.text, log.kind), ...t.events] : t.events,
    }));
    void send(tripId, () => apiDelete(key === "members" ? `/trips/${tripId}/members/${id}` : `/trips/${tripId}/${PATHS[key]}/${id}`));
  },
  /** Re-order one day. Only those items move, so someone else's new activity isn't lost. */
  reorderActivities(tripId: string, day: number, ids: string[]) {
    mapTrip(tripId, (t) => {
      const others = t.activities.filter((a) => a.day !== day);
      const byId = new Map(t.activities.map((a) => [a.id, a]));
      return { ...t, activities: [...others, ...ids.flatMap((id) => byId.get(id) ?? [])] };
    });
    void send(tripId, () => apiPost(`/trips/${tripId}/activities/reorder`, { day, ids }));
  },
  /** Comments are posted individually, so two people commenting at once both land. */
  addComment(tripId: string, activityId: string, text: string, log?: { text: string; kind: string }) {
    const comment = { id: uid("c"), authorId: state.user.id, text, at: new Date().toISOString() };
    mapTrip(tripId, (t) => ({
      ...t,
      activities: t.activities.map((a) => (a.id === activityId ? { ...a, comments: [...a.comments, comment] } : a)),
      events: log ? [event(log.text, log.kind), ...t.events] : t.events,
    }));
    void send(tripId, () => apiPost(`/trips/${tripId}/activities/${activityId}/comments`, { id: comment.id, text }));
  },
  addAttachment(tripId: string, activityId: string, name: string, url: string) {
    mapTrip(tripId, (t) => ({ ...t, activities: t.activities.map((a) => (a.id === activityId ? { ...a, attachments: [...a.attachments, { name, url }] } : a)) }));
    void send(tripId, () => apiPost(`/trips/${tripId}/activities/${activityId}/attachments`, { name, url }));
  },
  /** Moves the whole trip to another currency. The server converts everything in one step. */
  convertCurrency(tripId: string, currency: string, rate: number) {
    void send(tripId, () => apiPost(`/trips/${tripId}/convert-currency`, { currency, rate }));
  },
  vote(tripId: string, pollId: string, optionId: string) {
    const me = state.user.id;
    // Sends the intended result, not a toggle, so a retry after a lost response can't undo the vote.
    const selected = !state.trips.find((t) => t.id === tripId)?.polls.find((p) => p.id === pollId)?.options.find((o) => o.id === optionId)?.votes.includes(me);
    mapTrip(tripId, (t) => ({
      ...t,
      polls: t.polls.map((p) =>
        p.id !== pollId ? p : {
          ...p,
          options: p.options.map((o) => {
            const without = o.votes.filter((v) => v !== me);
            return o.id === optionId && !o.votes.includes(me) ? { ...o, votes: [...without, me] } : { ...o, votes: without };
          }),
        },
      ),
    }));
    void send(tripId, () => apiPost(`/trips/${tripId}/polls/${pollId}/vote`, { optionId, selected }));
  },

  markRead(id?: string) {
    set({ ...state, notifications: state.notifications.map((n) => (!id || n.id === id ? { ...n, read: true } : n)) });
    apiPost("/notifications/read", { id }).catch((e) => toast.error(apiErrorMessage(e)));
  },
  dismissNotification(id: string) {
    set({ ...state, notifications: state.notifications.filter((n) => n.id !== id) });
    apiDelete(`/notifications/${id}`).catch((e) => toast.error(apiErrorMessage(e)));
  },
  /** Accept an invitation. Returns the trip's id. */
  async acceptInvite(notificationId: string) {
    const trip = await apiPost<Trip>(`/notifications/${notificationId}/accept`);
    set({
      ...state,
      trips: [...state.trips.filter((t) => t.id !== trip.id), trip],
      notifications: state.notifications.filter((n) => n.id !== notificationId),
    });
    return trip.id;
  },
};

void loadState();
