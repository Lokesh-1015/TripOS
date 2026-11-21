// Records a page as a sharp 1080×1920 clip. Playwright's own video records at CSS-pixel size, so this
// uses Chrome's screencast instead, which sends frames at the device's full resolution.
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FFMPEG, SIZE, ensureDir, sleep } from "./lib.mjs";

const BG = "0xF7F6F2";

/** Captions and tap ripples drawn on top of the app while it records. They sit outside React's root. */
export const OVERLAY_CSS = `
  #mk-caption { position: fixed; left: 50%; top: 13%; transform: translateX(-50%); z-index: 2147483646; width: 88%;
    text-align: center; pointer-events: none; font: 800 25px/1.18 "Plus Jakarta Sans", system-ui, sans-serif; color: #fff;
    letter-spacing: -0.01em; text-wrap: balance; }
  #mk-caption span { background: rgba(16, 40, 33, 0.9); padding: 6px 14px; border-radius: 14px; box-decoration-break: clone;
    -webkit-box-decoration-break: clone; line-height: 1.55; box-shadow: 0 8px 24px rgba(0,0,0,.18); }
  #mk-caption.mk-in { animation: mk-pop .35s cubic-bezier(.2,.9,.3,1.2) both; }
  @keyframes mk-pop { from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(.96); } }
  .mk-tap { position: fixed; z-index: 2147483647; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
    background: rgba(233, 122, 86, .35); border: 3px solid #E97A56; pointer-events: none; animation: mk-tap .6s ease-out forwards; }
  @keyframes mk-tap { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
  /* Meme style: bigger and punchier, for text-led videos. */
  #mk-caption.mk-big { top: 10.5%; font-size: 30px; line-height: 1.12; }
  #mk-caption.mk-big span { background: #111; padding: 7px 15px; border-radius: 12px; line-height: 1.5; }
  /* Draws the eye to the line that matters. */
  .mk-hl { position: relative; z-index: 5; outline: 4px solid #E97A56 !important; outline-offset: 2px; border-radius: 14px;
    animation: mk-hl .9s ease-in-out infinite alternate; }
  @keyframes mk-hl { from { box-shadow: 0 0 0 0 rgba(233,122,86,.5); } to { box-shadow: 0 0 0 12px rgba(233,122,86,0); } }
  ::-webkit-scrollbar { display: none; }
`;

export async function installOverlay(page) {
  await page.addInitScript((css) => {
    const install = () => {
      if (document.getElementById("mk-style")) return;
      const style = document.createElement("style");
      style.id = "mk-style";
      style.textContent = css;
      document.head.appendChild(style);
      // Show where a finger tapped.
      document.addEventListener("pointerdown", (e) => {
        const dot = document.createElement("div");
        dot.className = "mk-tap";
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 700);
      }, true);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
    else install();
  }, OVERLAY_CSS);
}

export async function setCaption(page, text, { big = false } = {}) {
  await page.evaluate(({ t, css, big }) => {
    if (!document.getElementById("mk-style")) {
      const style = document.createElement("style");
      style.id = "mk-style";
      style.textContent = css;
      document.head.appendChild(style);
    }
    document.getElementById("mk-caption")?.remove();
    if (!t) return;
    const box = document.createElement("div");
    box.id = "mk-caption";
    box.className = big ? "mk-in mk-big" : "mk-in";
    const span = document.createElement("span");
    span.textContent = t;
    box.appendChild(span);
    document.body.appendChild(box);
  }, { t: text ?? "", css: OVERLAY_CSS, big });
}

/**
 * Runs `act` while recording, then holds the last screen until at least `minMs` has passed.
 * Writes an H.264 clip of exactly the recorded length and returns its duration in seconds.
 */
export async function record(page, outFile, act, minMs = 0) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
  // A tiny repaint makes sure the first frame arrives at once, even on a still page.
  await page.evaluate(() => { document.body.style.outline = "0 solid transparent"; });
  const start = Date.now() / 1000;
  await act();
  const left = minMs - (Date.now() / 1000 - start) * 1000;
  if (left > 0) await sleep(left);
  const end = Date.now() / 1000;
  await sleep(120);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();
  if (!frames.length) throw new Error(`No frames were recorded for ${path.basename(outFile)}`);

  // Each frame lasts until the next one; Chrome only sends a frame when something changes.
  const dir = ensureDir(`${outFile}.frames`);
  const kept = frames.filter((f) => f.t <= end);
  if (!kept.length) kept.push(frames[0]);
  const lines = [];
  kept.forEach((f, i) => {
    const file = path.join(dir, `${String(i).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    const from = i === 0 ? start : f.t;
    const until = i + 1 < kept.length ? kept[i + 1].t : end;
    lines.push(`file '${file.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, until - from).toFixed(4)}`);
  });
  lines.push(`file '${path.join(dir, `${String(kept.length - 1).padStart(5, "0")}.jpg`).replace(/\\/g, "/")}'`);
  const list = path.join(dir, "list.txt");
  writeFileSync(list, lines.join("\n"));
  const seconds = end - start;
  const r = spawnSync(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=30,format=yuv420p`,
    "-t", seconds.toFixed(3), "-c:v", "libx264", "-preset", "medium", "-crf", "17", outFile,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg couldn't build ${path.basename(outFile)}: ${r.stderr}`);
  rmSync(dir, { recursive: true, force: true });
  return seconds;
}
