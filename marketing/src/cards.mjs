// Title cards drawn as HTML and recorded like the app, so they share its look and resolution.
// Each one animates by itself over a few seconds; the recorder holds it for the voice line's length.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./lib.mjs";

const logo = () => {
  const file = path.join(ASSETS, "logo.png");
  return existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString("base64")}` : "";
};
const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const base = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  :root { --forest: #12443A; --coral: #E97A56; --ink: #1D2421; --muted: #6B746F; --bg: #F7F6F2; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; background: var(--bg); font-family: "Plus Jakarta Sans", system-ui, sans-serif; color: var(--ink); overflow: hidden; }
  .logo { mix-blend-mode: multiply; }
  @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
  @keyframes pop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
  ${css}
</style></head><body>${body}</body></html>`;

/** The problem: a group chat drowning in trip questions. A made-up group, not any real app's design. */
function groupChat({ title = "Spiti trip 🏔️", messages = [] }) {
  const msgs = messages.length ? messages : [
    ["Rohan", "who's booking the homestay??"],
    ["Ananya", "how much do I owe you for the bikes"],
    ["Kabir", "wait which day are we in Kaza"],
    ["Rohan", "can someone resend the itinerary 😭"],
    ["Ananya", "did anyone pack the permits?"],
    ["Kabir", "?? anyone"],
  ];
  const colors = ["#E97A56", "#3B82F6", "#8B5CF6"];
  const who = [...new Set(msgs.map(([n]) => n))];
  const bubbles = msgs.map(([name, text], i) => `
    <div class="msg" style="animation-delay:${0.15 + i * 0.32}s">
      <b style="color:${colors[who.indexOf(name) % colors.length]}">${esc(name)}</b>${esc(text)}
    </div>`).join("");
  return base(`
    <div class="phone">
      <header><div class="av">${esc(title).slice(0, 1)}</div><div><p class="t">${esc(title)}</p><p class="s">Rohan, Ananya, Kabir, You</p></div><span class="badge">128</span></header>
      <main>${bubbles}</main>
      <footer><div class="input">Message</div></footer>
    </div>`, `
    body { background: #ECE8E1; }
    .phone { position: absolute; inset: 0; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; gap: 10px; padding: 46px 16px 12px; background: #fff; border-bottom: 1px solid #e5e1d8; }
    .av { width: 38px; height: 38px; border-radius: 50%; background: var(--forest); color: #fff; display: grid; place-items: center; font-weight: 700; }
    .t { font-weight: 700; font-size: 16px; } .s { font-size: 12px; color: var(--muted); }
    .badge { margin-left: auto; background: var(--coral); color: #fff; font-weight: 800; font-size: 13px; padding: 3px 9px; border-radius: 999px; animation: pop .4s 1.6s both; }
    main { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 9px; padding: 14px 14px 10px; }
    .msg { align-self: flex-start; max-width: 82%; background: #fff; padding: 9px 12px 10px; border-radius: 4px 16px 16px 16px; font-size: 16px; line-height: 1.3; box-shadow: 0 1px 1px rgba(0,0,0,.06); animation: rise .35s both; }
    .msg b { display: block; font-size: 12px; margin-bottom: 2px; }
    footer { padding: 10px 12px 26px; background: #fff; } .input { border: 1px solid #e5e1d8; border-radius: 999px; padding: 11px 16px; color: #9aa19d; font-size: 15px; }
  `);
}

/** The answer: the logo and one line about what TripOS is. */
function logoCard({ tagline = "One app for the whole trip" }) {
  return base(`
    <div class="wrap">
      <img class="logo" src="${logo()}" alt="TripOS">
      <p class="tag">${esc(tagline)}</p>
    </div>`, `
    body { background: #fff; }
    .wrap { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 18px; padding: 0 22px; }
    .logo { width: 330px; animation: pop .7s cubic-bezier(.2,.9,.3,1.2) both; }
    .tag { font-weight: 700; font-size: 22px; color: var(--forest); text-align: center; animation: rise .5s .55s both; }
  `);
}

/** The ending: logo, the promise, and where to go. */
function endCard({ tagline = "Plan together. Travel together. Remember together.", cta = "Free · Link in bio", url = "tripos-travel.vercel.app" }) {
  return base(`
    <div class="wrap">
      <img class="logo" src="${logo()}" alt="TripOS">
      <p class="tag">${esc(tagline)}</p>
      <p class="cta">${esc(cta)}</p>
      <p class="url">${esc(url)}</p>
    </div>`, `
    body { background: #fff; }
    .wrap { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 16px; padding: 0 28px; text-align: center; }
    .logo { width: 300px; animation: pop .6s both; }
    .tag { font-weight: 800; font-size: 25px; line-height: 1.25; color: var(--ink); text-wrap: balance; animation: rise .5s .35s both; }
    .cta { margin-top: 6px; background: var(--coral); color: #fff; font-weight: 800; font-size: 19px; padding: 12px 22px; border-radius: 16px; animation: pop .45s .8s both; }
    .url { color: var(--muted); font-weight: 600; font-size: 15px; animation: rise .5s 1.1s both; }
  `);
}

/** A plain statement on a coloured background, for any line that doesn't need a screen. */
function textCard({ text = "", background = "#12443A" }) {
  return base(`<div class="wrap"><p>${esc(text)}</p></div>`, `
    body { background: ${background}; }
    .wrap { position: absolute; inset: 0; display: grid; place-content: center; padding: 0 30px; }
    p { color: #fff; font-weight: 800; font-size: 34px; line-height: 1.2; text-align: center; text-wrap: balance; animation: rise .5s both; }
  `);
}

export const CARDS = { groupChat, logo: logoCard, endCard, text: textCard };
