# Ark Director Studio

Built with the Ark engine: https://github.com/omiron33/ark-video-studio

A video generation and editing studio for Ark films, both code-drawn and live action. It runs on the
machine that has ComfyUI and its GPU queue, and reaches the Ark engine over ssh. Story in, film out:
break a story or lyrics into sequences and shots, storyboard every shot, block it in Blender, generate
takes with MiniMax H3 or Grok Imagine, review whole sequences on a timeline, and hand prompts back to
the engine.

Made for a 2560x1440 screen. Nothing scrolls off the page: each tab is a set of cards that collapse to
their header and scroll inside themselves.

## Tabs

| Tab | What it is for |
| --- | --- |
| Films | Your films, a new one, or an Ark song folder opened in the studio |
| Story | The script or lyrics, the film style and audio, and the breakdown into sequences and shots by Claude, Codex or Grok Build |
| Storyboard | One card per shot: frame, prompt, camera and characters, plus regenerate, reorder and delete. Frame the rest, take a whole sequence, assemble it. The sequence's continuity plan sits beside it |
| Shot | The chosen take large, every take with ratings, the shot's settings, and what the next take will start from |
| Sketch | Draw the frame yourself with stick figures, lines, boxes, circles, arrows and labels, then generate storyboard frames that follow the drawing |
| Cast & looks | Character sheets, 3D character models and look images. Sheets ride along on every still and take a character is in; the model is the figure every greybox builds for them, shown as a front, side and back render |
| Greybox | A top-down plan of figures (with where they walk to), props that can topple, lights and the camera move over the sequence's shared set, rendered in Blender as the guide clip for H3 |
| Timeline | A live cut of the chosen takes with the audio under them, the tracks, assembling, and an agent's review of the whole sequence |
| Queue | Studio jobs and logs, and the machine's GPU queue across every agent |
| Ark engine | The film's video type, pull and push film.json, and the engine's own steps for that type: storyboard, draft, stills, the render at its tier, photoreal repaints, music video, checks, critic |
| Settings | Connections, agents, the Grok Imagine window |

**Basic** shows the prompt, length, camera, characters and look, and picks everything else. **Expert**
adds the engine per take, seeds, steps, greybox guide steps, start-frame overrides, lens and move,
Grok frames and every engine command with its options.

## Video types

Every film has a video type, and every flag the Ark engine has is on it:

| Video type | Pictures | Shot cohesion |
| --- | --- | --- |
| Ultra code lyric film (the default) | Pure code at the ultra tier, words drawn in the world | Relaxed |
| Premium code lyric film | Pure code, 60 fps premium tier | Relaxed |
| Fast code preview | 30 fps, no review gates | Relaxed |
| Photoreal lyric film | Code scenes repainted by H3, words stay code | On |
| Music video | H3 shots cut with code shots, pop camera | On for generated shots |
| Narrated story, code or photoreal | A narrated story through the story pipeline | Relaxed for code, on for photoreal |
| Live-action film | H3 from prompts, sheets and greyboxes | On |

Expert mode sets each flag on its own: the code tier (fast, standard, premium, ultra), 1080p or 4K,
words in the scene, over the picture or none, shot cohesion (auto, on, off), and for H3 repaints the
long-take chaining (bridges, or Continuum on trial), the style reference, word tucking, steps, steered
steps and proxy blur, plus the music video's pop camera and rendering code scenes on the Mac only.
The Ark engine tab passes them to the engine as its own flags and writes the tier and resolution back
to film.json on push.

## Sketch a scene

The Sketch tab is for building a frame by hand. Drag from head to feet to place a stick figure, and add
lines, boxes, circles, arrows (who moves or looks where) and labels. Shapes stay editable: select,
move, drag an end, undo. Say in words who is who, pick how closely to follow the drawing (exactly, as
a layout, or as an idea) and generate up to four frames. Qwen-Image sees the drawing as a reference
image next to the shot's prompt. Pick one and it becomes the shot's storyboard frame, which the next
take starts from.

## Shots that stay consistent

Generated pictures need cohesion, so for photoreal, music video and live-action films the easy path is
the cohesive one. Pure code films draw every frame from song time, so cohesion is relaxed there unless
you turn it on:

- Each sequence has one continuity plan (place, time, light, who stands where), added to every prompt in it.
- Each take starts from the last frame of the take before it while the sequence chains; the first take starts from its storyboard frame.
- Every character in a shot rides along as a reference image from their sheet, and the sequence's look image as a style reference.
- Review happens on assembled sequences, not single frames.

## How it connects

- **ComfyUI** over its HTTP API. Every GPU job (frames, sheets, looks, takes, greybox renders) first waits its turn on the GPU queue dashboard, so it never overlaps another job.
- **H3 takes** use the same graph as the engine's photorealistic setting: reference-to-video with an optional guide video for the first denoise steps, character sheets and look as reference images, and start and end frames anchored as guides (first and last-frame bridges).
- **Ark engine**: a thin adapter (`server/ark.ts`) reads film.json, writes back only scene prompts and take plans (keeping `film.json.studio-bak`), and runs the engine's own commands. Engine changes stay in the engine.
- **Agents**: Claude, Codex and Grok Build through their own command-line tools, text in and text out.
- **Grok Imagine**: a real browser window with its own profile, signed in to your Grok subscription by you. If Grok asks for a human check, the job stops and says so.
- **Blender**: `blender/greybox.py` builds each character from their model (height, build, costume, what they carry, the light they carry, or a crowd), the sequence's set, lights, mist and the camera move, and renders the guide clip in EEVEE. Storyboard stills follow the greybox's first frame and the characters' sheets as reference images.

## Run it

Node 20 or later, ffmpeg, Blender, ComfyUI with the MiniMax H3 and Qwen-Image models.

```bash
npm install
cp studio.config.example.json studio.config.json   # then fill in your paths
npm run build
npm start                                          # http://localhost:5320
```

`npm run dev` runs the server and a hot-reloading client on port 5321. On Windows,
`scripts/install-task.ps1` starts the studio at logon in your desktop session, so its Grok and Blender
windows open where you can see them.

Projects and their media live under `data/` (not committed).

## Tests

```bash
npm run typecheck
npm test
npm run ui-shots -- http://localhost:5320 shots   # every tab at 2560x1440: screenshots, overflow, console errors
```

Set `CHROME` to a Chrome or Chromium binary if it isn't at the macOS default.

## Credits

Ideas borrowed from [Director's Console](https://github.com/NickPittas/DirectorsConsole) (MIT): cinematography presets, per-shot panels and a project gallery. The H3 graph follows the Ark engine's photorealistic setting, which uses Code Video Model's early-step conditioning (Apache 2.0).

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).
