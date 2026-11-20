// The voiceover: Piper, a free neural voice that runs on this computer. One WAV per scene.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VOICES } from "./lib.mjs";

export function voiceModel(name) {
  const file = path.join(VOICES, `${name}.onnx`);
  if (!existsSync(file)) {
    const have = existsSync(VOICES) ? spawnSync("ls", [VOICES], { encoding: "utf8" }).stdout : "";
    throw new Error(`Voice "${name}" isn't installed in marketing/voices. Installed: ${have.split(/\s+/).filter((f) => f.endsWith(".onnx")).join(", ") || "none"}`);
  }
  return file;
}

/** Speaks `text` into `outFile`. `pace` above 1 is slower, below 1 faster. Returns seconds. */
export function speak(text, outFile, { voice = "en_US-amy-medium", pace = 1 } = {}) {
  const r = spawnSync("python", ["-m", "piper", "-m", voiceModel(voice), "-f", outFile, "--length-scale", String(pace), "--sentence-silence", "0.15"], { input: text, encoding: "utf8" });
  if (r.status !== 0 || !existsSync(outFile)) throw new Error(`Piper couldn't speak "${text}": ${r.stderr || r.error}`);
  return wavSeconds(outFile);
}

/** Length of a PCM WAV, read from its header. */
export function wavSeconds(file) {
  const b = readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let i = 12;
  while (i < b.length - 8) {
    const id = b.toString("ascii", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "data") return size / byteRate;
    i += 8 + size;
  }
  return 0;
}
