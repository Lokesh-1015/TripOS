// Puts it together: each scene's clip with its voice line, all scenes in order, optional music under
// the voice, loudness set for Instagram, and a cover image.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FFMPEG } from "./lib.mjs";

function ffmpeg(args, what) {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg couldn't ${what}: ${r.stderr}`);
}

/**
 * A scene's clip with its voice starting just after the cut, and silence for the rest. When the action
 * took longer than its line, the clip is sped up (by at most `maxSpeed`) so the scene ends with the line.
 * Returns the scene's final length in seconds.
 */
export function sceneWithVoice(clip, voice, seconds, outFile, { target = seconds, maxSpeed = 1.5, lead = 0.15, zoom = 1 } = {}) {
  const ms = Math.round(lead * 1000);
  const speed = Math.min(maxSpeed, Math.max(1, seconds / target));
  const length = seconds / speed;
  const frames = Math.max(1, Math.round(length * 30));
  // A slow push-in (zoom above 1) keeps a still screen alive. Upscaled first so the movement stays smooth.
  const push = zoom > 1.001
    ? `,scale=2160:3840:flags=lanczos,zoompan=z='1+${(zoom - 1).toFixed(4)}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`
    : "";
  const video = `[0:v]${speed > 1.02 ? `setpts=PTS/${speed.toFixed(4)},` : ""}fps=30${push}[v]`;
  const audio = voice && existsSync(voice) ? `[1:a]aresample=48000,adelay=${ms}|${ms},apad[a]` : "anullsrc=r=48000:cl=stereo[a]";
  const inputs = voice && existsSync(voice) ? ["-i", clip, "-i", voice] : ["-i", clip];
  ffmpeg([
    ...inputs, "-filter_complex", `${video};${audio}`, "-map", "[v]", "-map", "[a]", "-t", length.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000", outFile,
  ], `add the voice to ${path.basename(clip)}`);
  return length;
}

/** Joins the scenes, adds music if there is any, and normalises the loudness. */
export function finish(scenes, outFile, { music, musicVolume = 0.12, workDir }) {
  const list = path.join(workDir, "scenes.txt");
  writeFileSync(list, scenes.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  const joined = path.join(workDir, "joined.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], "join the scenes");
  const total = Number(spawnSync(FFMPEG, ["-i", joined], { encoding: "utf8" }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)?.slice(1).reduce((s, v, i) => s + Number(v) * [3600, 60, 1][i], 0) ?? 0);
  if (music && existsSync(music)) {
    const fadeAt = Math.max(0, total - 1.5).toFixed(2);
    ffmpeg([
      "-i", joined, "-stream_loop", "-1", "-i", music,
      "-filter_complex", `[1:a]volume=${musicVolume},afade=t=in:d=0.8,afade=t=out:st=${fadeAt}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
      "-map", "0:v", "-map", "[a]", "-t", total.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile,
    ], "mix in the music");
  } else {
    ffmpeg(["-i", joined, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile], "set the loudness");
  }
  return total;
}

/** One frame as the Reel's cover image. */
export function cover(video, atSeconds, outFile) {
  ffmpeg(["-ss", atSeconds.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "2", outFile], "save the cover");
}
