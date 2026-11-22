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
function groupChat({ title = "Spiti trip 🏔️", messages = [], interval = 0.32, typing = false, unread = 128 }) {
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
  // "You" sits on the right, like any chat; everyone else on the left with a name colour.
  const bubbles = msgs.map(([name, text], i) => name === "You"
    ? `<div class="msg me" style="animation-delay:${0.15 + i * interval}s">${esc(text)}</div>`
    : `<div class="msg" style="animation-delay:${0.15 + i * interval}s">
      <b style="color:${colors[who.indexOf(name) % colors.length]}">${esc(name)}</b>${esc(text)}
    </div>`).join("") + (typing ? `<div class="msg dots" style="animation-delay:${0.15 + msgs.length * interval}s"><i></i><i></i><i></i></div>` : "");
  return base(`
    <div class="phone">
      <header><div class="av">${esc(title).slice(0, 1)}</div><div><p class="t">${esc(title)}</p><p class="s">Rohan, Ananya, Kabir, You</p></div><span class="badge">${unread}</span></header>
      <main>${bubbles}</main>
      <footer><div class="input">Message</div></footer>
    </div>`, `
    body { background: #ECE8E1; }
    .phone { position: absolute; inset: 0; display: flex; flex-direction: column; }
    header { display: flex; align-items: center; gap: 10px; padding: 46px 16px 12px; background: #fff; border-bottom: 1px solid #e5e1d8; }
    .av { width: 38px; height: 38px; border-radius: 50%; background: var(--forest); color: #fff; display: grid; place-items: center; font-weight: 700; }
    .t { font-weight: 700; font-size: 16px; } .s { font-size: 12px; color: var(--muted); }
    .badge { margin-left: auto; background: var(--coral); color: #fff; font-weight: 800; font-size: 13px; padding: 3px 9px; border-radius: 999px; animation: pop .4s 1.6s both; }
    main { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; padding: 14px 14px 10px; }
    /* Each message takes no room until it arrives, then grows in at the bottom and pushes the rest up. */
    .msg { align-self: flex-start; max-width: 82%; background: #fff; padding: 9px 12px 10px; border-radius: 4px 16px 16px 16px; font-size: 16px; line-height: 1.3;
      box-shadow: 0 1px 1px rgba(0,0,0,.06); flex-shrink: 0; max-height: 0; margin-top: 0; padding-top: 0; padding-bottom: 0; opacity: 0; overflow: hidden;
      animation: arrive .3s ease-out both; }
    @keyframes arrive { to { max-height: 140px; margin-top: 9px; padding-top: 9px; padding-bottom: 10px; opacity: 1; } }
    .msg b { display: block; font-size: 12px; margin-bottom: 2px; }
    .msg.me { align-self: flex-end; background: #DDF2E5; border-radius: 16px 4px 16px 16px; }
    .msg.dots { display: flex; gap: 5px; padding-left: 14px; padding-right: 14px; }
    .msg.dots i { width: 7px; height: 7px; border-radius: 50%; background: #9aa19d; animation: blink 1s infinite; }
    .msg.dots i:nth-child(2) { animation-delay: .2s; } .msg.dots i:nth-child(3) { animation-delay: .4s; }
    @keyframes blink { 50% { opacity: .25; } }
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

/**
 * A scroll-stopping opener: a real trip photo drifting slowly, a big number that lands at once, and the
 * promise of the list. Text is on screen from the very first frame.
 */
function hookTitle({ number = "5", title = "types of friends on every group trip", note = "which one are you? 👀", photo = "photo-1655574515985-5ee58bc3ca5c" }) {
  const bg = `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1200&h=2133&q=80`;
  return base(`
    <div class="bg" style="background-image:url('${bg}')"></div>
    <div class="shade"></div>
    <div class="wrap">
      <p class="num">${esc(number)}</p>
      <p class="title">${esc(title)}</p>
      <p class="note">${esc(note)}</p>
    </div>`, `
    body { background: #0d1f1a; }
    .bg { position: absolute; inset: -4%; background-size: cover; background-position: center; animation: drift 6s ease-out both; }
    @keyframes drift { from { transform: scale(1.12); } to { transform: scale(1); } }
    .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.35) 40%, rgba(8,24,20,.85) 100%); }
    .wrap { position: absolute; left: 0; right: 0; bottom: 17%; padding: 0 26px; color: #fff; }
    .num { font-weight: 800; font-size: 150px; line-height: .9; color: var(--coral); text-shadow: 0 6px 30px rgba(0,0,0,.35); animation: slam .45s cubic-bezier(.2,1.4,.4,1) both; }
    @keyframes slam { from { transform: scale(2.2) rotate(-8deg); opacity: 0; } to { transform: none; opacity: 1; } }
    .title { margin-top: 6px; font-weight: 800; font-size: 40px; line-height: 1.08; letter-spacing: -.02em; text-wrap: balance; text-transform: uppercase; animation: rise .35s .12s both; }
    .note { margin-top: 16px; display: inline-block; background: #fff; color: var(--ink); font-weight: 800; font-size: 20px; padding: 8px 14px; border-radius: 12px; animation: pop .35s .6s both; }
  `);
}

export const CARDS = { groupChat, logo: logoCard, endCard, text: textCard, hookTitle };
