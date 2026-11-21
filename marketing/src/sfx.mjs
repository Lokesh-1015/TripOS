// Small sound effects, synthesised with ffmpeg so there's nothing to license or download.
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FFMPEG, WORK, ensureDir } from "./lib.mjs";

const RECIPES = {
  // A soft chat-message pop.
  pop: ["-f", "lavfi", "-i", "aevalsrc='0.55*sin(2*PI*(900+2200*exp(-40*t))*t)*exp(-28*t)':d=0.16:s=48000"],
  // Air moving past: filtered noise that swells and fades, for a scene change.
  whoosh: ["-f", "lavfi", "-i", "anoisesrc=d=0.5:c=pink:a=0.6:r=48000", "-af", "bandpass=f=1400:width_type=h:w=1800,afade=t=in:d=0.22,afade=t=out:st=0.22:d=0.28,volume=2.2"],
  // Two rising notes: something worked.
  ding: ["-f", "lavfi", "-i", "aevalsrc='0.45*sin(2*PI*880*t)*exp(-5*t)+0.4*sin(2*PI*1318.5*t)*exp(-4*(t-0.11))*gte(t,0.11)':d=0.9:s=48000"],
  // A light tick, for pointing at something.
  tick: ["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*2100*t)*exp(-90*t)':d=0.06:s=48000"],
};

export const SOUNDS = Object.keys(RECIPES);

/** The WAV for a named effect, made once and reused. */
export function sfx(name) {
  if (!RECIPES[name]) throw new Error(`No sound effect "${name}". Effects: ${SOUNDS.join(", ")}`);
  const file = path.join(ensureDir(path.join(WORK, "sfx")), `${name}.wav`);
  if (!existsSync(file)) {
    const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...RECIPES[name], "-ac", "2", "-ar", "48000", file], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Couldn't make the "${name}" sound: ${r.stderr}`);
  }
  return file;
}
