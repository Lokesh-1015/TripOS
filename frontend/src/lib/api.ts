// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  // Auth rides the httpOnly session cookie automatically — never add auth headers here.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body?: JsonBody) => request<T>("PATCH", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

/** The message to show a person when a request fails. The server's own wording is written for this. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const message = (err.body as { message?: unknown } | null)?.message;
    if (typeof message === "string") return message;
    if (err.status === 401) return "Your session has ended. Please log in again.";
    if (err.status >= 500) return "Something went wrong on our side. Please try again.";
    return "That couldn't be saved. Please try again.";
  }
  return "Can't reach TripOS. Check your connection and try again.";
}

export interface UploadedFile {
  id: string;
  url: string;
}

/** Uploads a file; the returned URL is what screens store and display. Public is for avatars and covers. */
export async function uploadFile(file: File, options: { visibility: "public" | "shared" | "private"; tripId?: string }): Promise<UploadedFile> {
  const form = new FormData();
  form.append("visibility", options.visibility);
  if (options.tripId) form.append("tripId", options.tripId);
  form.append("file", file);
  const res = await fetch(`${BASE}/files`, { method: "POST", body: form });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as UploadedFile;
}
