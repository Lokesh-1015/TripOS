// A copy of the signed-in person's trips on this device, so a trip can be opened with no signal.
// It's wiped on sign-out and whenever the server says the session has ended.
import type { AppState } from "./types";

const DATABASE = "tripos-offline";
const STORE = "snapshots";
const KEY = "state";

export type OfflineCopy = Omit<AppState, "loading" | "offline" | "offlineCopy">;

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Passports and IDs never stay on the device, so documents are left out, along with anything naming one. */
export async function saveOfflineCopy(state: OfflineCopy) {
  const copy: OfflineCopy = {
    ...state,
    trips: state.trips.map((trip) => ({ ...trip, documents: [], events: trip.events.filter((event) => event.kind !== "document") })),
    notifications: state.notifications.filter((notification) => notification.kind !== "document"),
  };
  await run("readwrite", (store) => store.put(copy, KEY)).catch(() => undefined);
}

export async function readOfflineCopy() {
  return run<OfflineCopy | undefined>("readonly", (store) => store.get(KEY)).catch(() => undefined);
}

export async function clearOfflineCopy() {
  await run("readwrite", (store) => store.delete(KEY)).catch(() => undefined);
}
