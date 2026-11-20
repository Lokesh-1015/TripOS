// npm run setup — one-time: checks Piper (the free voice) and downloads the default voice if it's missing.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VOICES, ensureDir, log } from "./lib.mjs";

const VOICE = process.argv[2] ?? "en_US-amy-medium";
const piper = spawnSync("python", ["-m", "piper", "--help"], { encoding: "utf8" });
if (piper.status !== 0) {
  console.error("Piper isn't installed. Run:  python -m pip install --user piper-tts   then run this again.");
  process.exit(1);
}
log("Piper is installed");

// Official Piper voices: https://huggingface.co/rhasspy/piper-voices
const [lang, name, quality] = VOICE.split(/[-]/);
const family = lang.split("_")[0];
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${family}/${lang}/${name}/${quality}/${VOICE}`;
ensureDir(VOICES);
for (const ext of [".onnx", ".onnx.json"]) {
  const file = path.join(VOICES, `${VOICE}${ext}`);
  if (existsSync(file)) continue;
  log(`downloading ${VOICE}${ext}`);
  const res = await fetch(`${base}${ext}`);
  if (!res.ok) throw new Error(`Couldn't download ${VOICE}${ext} (${res.status}). Check the name at https://huggingface.co/rhasspy/piper-voices`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
log(`voice ${VOICE} ready in marketing/voices`);
