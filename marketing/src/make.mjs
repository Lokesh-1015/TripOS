// npm run video -- <episode> [--no-seed] [--only=sceneId,…] [--keep]
// Seeds the demo world, records every scene in the local app, voices it, and renders out/<episode>.mp4.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ACTIONS } from "./actions.mjs";
import { CARDS } from "./cards.mjs";
import { cover, finish, sceneWithSound } from "./compose.mjs";
import { sfx } from "./sfx.mjs";
import { API, EPISODES, OUT, ROOT, SCALE, Session, VIEWPORT, WEB, WORK, assertAppRunning, ensureDir, log, sleep } from "./lib.mjs";
import { installOverlay, record, setCaption } from "./recorder.mjs";
import { seed } from "./seed.mjs";
import { speak } from "./voice.mjs";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const flag = (f) => args.find((a) => a === `--${f}` || a.startsWith(`--${f}=`));
if (!name) {
  console.error("Usage: npm run video -- <episode>   (episodes live in marketing/episodes)");
  process.exit(1);
}
const file = path.join(EPISODES, name.endsWith(".json") ? name : `${name}.json`);
if (!existsSync(file)) {
  console.error(`No episode at ${file}`);
  process.exit(1);
}
const episode = JSON.parse(readFileSync(file, "utf8"));
const slug = path.basename(file, ".json");
const only = flag("only")?.split("=")[1]?.split(",");
const work = ensureDir(path.join(WORK, slug));

// Check the script before spending time recording it.
for (const s of episode.scenes) {
  if (s.card && !CARDS[s.card]) throw new Error(`Scene "${s.id}" uses card "${s.card}". Cards: ${Object.keys(CARDS).join(", ")}`);
  if (!s.card && !ACTIONS[s.action]) throw new Error(`Scene "${s.id}" uses action "${s.action}". Actions: ${Object.keys(ACTIONS).join(", ")}`);
}

await assertAppRunning();
const world = flag("no-seed") && existsSync(path.join(WORK, "world.json")) ? JSON.parse(readFileSync(path.join(WORK, "world.json"), "utf8")) : await seed();

// The narrator has seen the latest "What's new", so it doesn't pop up mid-video.
const latest = /id: "([^"]+)"/.exec(readFileSync(path.join(ROOT, "..", "frontend", "src", "lib", "releaseNotes.ts"), "utf8"))?.[1];
const narrator = new Session(world.ishita.email);
await narrator.must("POST", "/auth/login", { email: world.ishita.email, password: world.ishita.password });
if (latest) await narrator.must("PATCH", "/me", { seenReleaseNotes: latest });

// 1. Sound: voice lines and effects. The voice sets each scene's length.
// Lines come from `say` (at the start), or from captions when `voiceCaptions` is on or a caption has `say`.
const spoken = (t) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/…/g, "...").trim();
const plan = [];
for (const [index, s] of episode.scenes.entries()) {
  const sounds = [];
  const voice = { voice: s.voice ?? episode.voice, pace: s.pace ?? episode.pace ?? 1 };
  let end = 0;
  if (s.say) {
    const wav = path.join(work, `${s.id}.wav`);
    const said = speak(spoken(s.say), wav, voice);
    sounds.push({ file: wav, at: 0.15 });
    end = 0.15 + said;
  }
  // A spoken caption waits for the line before it to finish, and appears when it's said.
  s.timeline = (s.captions ?? []).map((c, i) => {
    const line = typeof c.say === "string" ? c.say : (c.say ?? episode.voiceCaptions) ? c.text : "";
    if (!line || !spoken(line)) return { ...c };
    const at = Math.max(c.at, end > 0 ? end - 0.08 : 0);
    const wav = path.join(work, `${s.id}-${i}.wav`);
    const said = speak(spoken(line), wav, voice);
    sounds.push({ file: wav, at: at + 0.12 });
    end = at + 0.12 + said;
    return { ...c, at };
  });
  // Effects: a whoosh on each cut, a pop for every chat message, and any the script asks for.
  if (episode.sfx !== false) {
    if (index > 0) sounds.push({ file: sfx("whoosh"), at: 0, volume: 0.45 });
    if (s.card === "groupChat") {
      const count = (s.params?.messages?.length ?? 6) + (s.params?.typing ? 1 : 0);
      for (let i = 0; i < count; i++) sounds.push({ file: sfx("pop"), at: 0.18 + i * (s.params?.interval ?? 0.32), volume: 0.5 });
    }
    for (const e of s.sfx ?? []) sounds.push({ file: sfx(e.sound), at: e.at, volume: e.volume ?? 0.7 });
  }
  const seconds = Math.max(s.hold ?? 0, end + (s.tail ?? 0.45));
  plan.push({ scene: s, sounds, minSeconds: seconds });
  log(`sound ${s.id}: ${end ? `voice ends at ${end.toFixed(1)}s` : "no voice"}, ${sounds.length} sound${sounds.length === 1 ? "" : "s"}`);
}

// 2. Record each scene in a phone-shaped browser, signed in as the narrator.
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: "en-IN", timezoneId: "Asia/Kolkata" });
const login = await context.request.post(`${WEB}/api/auth/login`, { data: { email: world.ishita.email, password: world.ishita.password } });
if (!login.ok()) throw new Error(`Couldn't sign the narrator in through ${WEB} (${login.status()})`);

async function settle(page) {
  await page.waitForLoadState("load");
  await page.locator('[data-testid="app-loading"], [data-testid="page-loading"]').first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
  // Fonts and images on screen; lazy images below the fold never load, so this waits at most a few seconds.
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visible = [...document.images].filter((i) => !i.complete && i.getBoundingClientRect().top < innerHeight);
    await Promise.race([Promise.all(visible.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 4000))]);
  });
  await sleep(900);
}

for (const p of plan) {
  const s = p.scene;
  p.clip = path.join(work, `${s.id}.mp4`);
  if (only && !only.includes(s.id) && existsSync(p.clip)) {
    p.seconds = Number(readFileSync(`${p.clip}.len`, "utf8"));
    continue;
  }
  const page = await context.newPage();
  await installOverlay(page);
  if (s.card) {
    await page.setContent(CARDS[s.card](s.params ?? {}), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(200);
  } else {
    await page.goto(`${WEB}${ACTIONS[s.action].start({ world, params: s.params ?? {} })}`);
    await settle(page);
  }
  // One caption, or a timeline of them: [{ "at": seconds, "text": "…" }], changing while the scene plays.
  const timeline = (s.timeline?.length ? s.timeline : null) ?? (s.caption === false ? [] : (s.caption ?? s.say) ? [{ at: 0, text: s.caption ?? s.say }] : []);
  const big = (s.captionStyle ?? episode.captionStyle) === "big";
  p.seconds = await record(page, p.clip, async () => {
    const began = Date.now();
    const captions = (async () => {
      for (const c of timeline) {
        const wait = c.at * 1000 - (Date.now() - began);
        if (wait > 0) await sleep(wait);
        await setCaption(page, c.text, { big });
      }
    })();
    if (!s.card) await ACTIONS[s.action].run(page, { world, params: s.params ?? {} });
    await captions;
  }, p.minSeconds * 1000);
  writeFileSync(`${p.clip}.len`, String(p.seconds));
  log(`recorded ${s.id}: ${p.seconds.toFixed(1)}s`);
  await page.close();
}
await browser.close();

// 3. Voice onto each clip, then everything together.
const parts = plan.map((p) => {
  const out = path.join(work, `${p.scene.id}.scene.mp4`);
  // A scene whose action outran its line is sped up a little to end with it, unless the script says "fit": false.
  p.final = sceneWithSound(p.clip, p.sounds, p.seconds, out, { target: p.scene.fit === false ? p.seconds : p.minSeconds, maxSpeed: p.scene.maxSpeed ?? episode.maxSpeed ?? 1.5, zoom: p.scene.zoom ?? 1 });
  return out;
});
ensureDir(OUT);
const video = path.join(OUT, `${slug}.mp4`);
const music = episode.music ? path.join(ROOT, episode.music) : null;
if (music && !existsSync(music)) log(`no music at ${episode.music}, so the video has the voice only (add a royalty-free track there to include one)`);
const total = finish(parts, video, { music, musicVolume: episode.musicVolume, workDir: work });

// 4. A cover image and the post text, ready for Instagram.
let at = 0;
for (const p of plan) {
  if (p.scene.id === episode.coverAt) break;
  at += p.final;
}
cover(video, at + 1.2, path.join(OUT, `${slug}-cover.jpg`));
if (episode.post) writeFileSync(path.join(OUT, `${slug}-post.txt`), `${episode.post.caption}\n\n${(episode.post.hashtags ?? []).map((h) => `#${h}`).join(" ")}\n`);
if (!flag("keep")) for (const f of ["joined.mp4", "scenes.txt"]) rmSync(path.join(work, f), { force: true });
log(`done: ${path.relative(path.join(ROOT, ".."), video)} (${total.toFixed(1)}s), with a cover and post text in marketing/out`);
void API;
