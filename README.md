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
| Cast & looks | Character sheets and look images. Sheets ride along on every take a character is in |
| Greybox | A top-down plan of figures, props and the camera move, rendered in Blender as the guide clip for H3 |
| Timeline | A live cut of the chosen takes with the audio under them, the tracks, assembling, and an agent's review of the whole sequence |
| Queue | Studio jobs and logs, and the machine's GPU queue across every agent |
| Ark engine | Pull and push film.json, and the engine's own steps: storyboard, draft, stills, photoreal takes, checks, critic |
| Settings | Connections, agents, the Grok Imagine window |

**Basic** shows the prompt, length, camera, characters and look, and picks everything else. **Expert**
adds the engine per take, seeds, steps, greybox guide steps, start-frame overrides, lens and move,
Grok frames and every engine command with its options.

## Shots that stay consistent

The easy path is the cohesive one:

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
- **Blender**: `blender/greybox.py` builds mannequins, boxes, a sun and the camera move, and renders the guide clip.

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
```

## Credits

Ideas borrowed from [Director's Console](https://github.com/NickPittas/DirectorsConsole) (MIT): cinematography presets, per-shot panels and a project gallery. The H3 graph follows the Ark engine's photorealistic setting, which uses Code Video Model's early-step conditioning (Apache 2.0).

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md).
