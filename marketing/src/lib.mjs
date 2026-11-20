// Shared pieces: where things live, the local app's addresses, and a small API client with cookies.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORK = path.join(ROOT, ".work");
export const OUT = path.join(ROOT, "out");
export const ASSETS = path.join(ROOT, "assets");
export const VOICES = path.join(ROOT, "voices");
export const EPISODES = path.join(ROOT, "episodes");
export const FFMPEG = ffmpegPath;

/** The local app. Videos are always made from a local copy with demo data, never the live site. */
export const WEB = process.env.TRIPOS_WEB ?? "http://localhost:3000";
export const API = process.env.TRIPOS_API ?? "http://localhost:4000/api";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** Phone-shaped, at 1080×1920 once multiplied by the device scale. */
export const VIEWPORT = { width: 390, height: 693 };
export const SCALE = 1080 / VIEWPORT.width;
export const SIZE = { width: 1080, height: 1920 };

export const ensureDir = (dir) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...parts) => console.log("•", ...parts);

/** A signed-in API session for one demo person, keeping their cookie between calls. */
export class Session {
  cookie = "";
  constructor(email) {
    this.email = email;
  }
  async req(method, url, body, { form } = {}) {
    const headers = this.cookie ? { Cookie: this.cookie } : {};
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${url}`, { method, headers, body: payload });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }
  async must(method, url, body, opts) {
    const r = await this.req(method, url, body, opts);
    if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

/** The verification link the local app emailed, read from Mailpit. */
export async function verifyToken(email) {
  for (let i = 0; i < 100; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Verify"`)}`)).json();
    if (found.messages?.length) {
      const text = (await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json()).Text;
      const token = /verify-email\/([\w-]+)/.exec(text)?.[1];
      if (token) return token;
    }
    await sleep(150);
  }
  throw new Error(`No verification email reached Mailpit for ${email}`);
}

/** Stops early with a clear message if the local app isn't running. */
export async function assertAppRunning() {
  const up = async (url) => fetch(url).then((r) => r.ok).catch(() => false);
  const problems = [];
  if (!(await up(`${API}/health`))) problems.push(`the backend at ${API} (cd server && npm run dev)`);
  if (!(await up(WEB))) problems.push(`the frontend at ${WEB} (cd frontend && npx vite --port 3000)`);
  if (!(await up(`${MAILPIT}/api/v1/info`))) problems.push(`Mailpit at ${MAILPIT} (docker compose up -d postgres mailpit)`);
  if (problems.length) throw new Error(`Start the local app first. Not reachable:\n  - ${problems.join("\n  - ")}`);
}
