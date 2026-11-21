# TripOS videos

Makes Instagram Reels (1080×1920 MP4) of TripOS from a script, using the real app and free tools only:

| Step | Tool |
|---|---|
| Demo data | `src/seed.mjs` builds a demo world in your **local** TripOS: Ishita, Rohan, Ananya and Kabir, with a planned Spiti trip, a finished Goa trip with photos, and an empty Kasol trip |
| Screens | Playwright drives the real app at phone size; Chrome's screencast records it at full resolution |
| Voice | [Piper](https://github.com/rhasspy/piper), a free voice that runs on your computer |
| Captions, taps | Drawn on the page while it records |
| Editing | ffmpeg (bundled through `ffmpeg-static`) |

Nothing is recorded from the live site, and no real person's data appears.

## One-time setup

```bash
cd marketing
npm install
python -m pip install --user piper-tts
npm run setup                       # downloads the default voice, en_US-amy-medium
npm run setup -- en_GB-alba-medium  # any other voice from huggingface.co/rhasspy/piper-voices
```

## Making a video

Start the local app (from the repo root):

```bash
docker compose up -d postgres mailpit
```

```bash
cd server && npm run dev
```

```bash
cd frontend && npx vite --port 3000
```

Then:

```bash
cd marketing && npm run video -- 01-what-is-tripos
```

Out come `out/01-what-is-tripos.mp4`, `-cover.jpg` (the Reel's cover) and `-post.txt` (caption and hashtags).

Useful flags: `--no-seed` reuses the last demo world; `--only=create,split` re-records just those scenes and reuses the rest.

## Writing an episode

Episodes are JSON files in `episodes/`. Each scene is one line of voiceover and one thing on screen:

```json
{
  "title": "…",
  "voice": "en_US-amy-medium",
  "pace": 0.95,
  "music": "assets/music.mp3",
  "coverAt": "create",
  "scenes": [
    { "id": "hook", "card": "groupChat", "say": "Planning a group trip in the group chat?" },
    { "id": "create", "action": "createTrip", "params": { "name": "Spiti Valley Ride" }, "say": "Plan it in seconds." },
    { "id": "end", "card": "endCard", "say": "TripOS. Link in bio.", "caption": false }
  ],
  "post": { "caption": "…", "hashtags": ["TripOS"] }
}
```

- `say` is spoken; `caption` is the text on screen (defaults to `say`; `false` for none).
- A scene lasts as long as its line. If the action takes longer, the clip is sped up (up to `maxSpeed`, 1.5×) to end with the line; `"fit": false` keeps it real-time.
- `hold` sets a minimum length in seconds; `pace` above 1 speaks slower.
- `captions` changes the text during a scene: `[{ "at": 0, "text": "…" }, { "at": 2.2, "text": "…" }]`. With `"voiceCaptions": true` (or `"say"` on a caption, which can be a different spoken wording), each one is read aloud, and a line waits for the one before it to finish. `"captionStyle": "big"` gives meme-sized captions.
- Sound effects are made locally and free: a whoosh on every cut and a pop for every chat message come automatically; add more with `"sfx": [{ "at": 1.4, "sound": "tick" }]` (`pop`, `whoosh`, `ding`, `tick`). `"sfx": false` on the episode turns them off.
- `"zoom": 1.06` slowly pushes in on a scene.
- **Cards** (`src/cards.mjs`): `groupChat`, `logo`, `endCard`, `text` (`params.text`).
- **Actions** (`src/actions.mjs`): `home`, `createTrip`, `inviteFriends`, `vote`, `addExpense`, `planAndPack`, `memories`, and `show` (`params.path` like `/app/trips/:spiti/map`, `params.scroll`). New flows are added there.

## Music

Put a royalty-free track at `assets/music.mp3`, for example from the YouTube Audio Library or Pixabay Music. It plays quietly under the voice and fades out. Without one, the video has the voice only.
