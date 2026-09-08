# Van Gogh — Starry Night

Interactive particle recreation of *The Starry Night*: stars gather in silence, then the sky begins to flow.

## Open

Double-click `index.html` (Chrome / Edge / Firefox recommended).  
Needs **WebGL2**. No install, no build step.

Files that must stay together:

- `index.html`
- `glow-global.js`
- `image_data.js`
- `kitten_motif_data.js` (mask only — never drawn on screen)

## Controls

| Input | Action |
| --- | --- |
| Move / drag | Stir the sky |
| **Space** | Pause / resume |
| **S** | Save screenshot (PNG) |
| **C** or **Controls** button | Open / close settings |
| **Esc** | Close settings |
| **Reveal** (after ~5s of free flight) | Fade → “For you.” → particles form a motif |
| **Return** | Scatter outward, then rejoin the starfield |

## Easter egg

About **5 seconds after the intro ends**, a **Reveal** chip appears (bottom-left). It does **not** paste an image — stars rearrange into a silhouette sampled from a private mask.

Sequence: fade → **For you.** → particles rush in from the edges through a short **storm**, then **slowly settle** from a soft blob into a readable shape (breathing fades in as it clarifies). **Return** dissolves the silhouette while a star-river layer is already present, then eases density and flow back — no empty-sky refill pop.

## Settings

- **Flow** — particle speed (0–1)
- **Swirl** — vortex strength (up to 2.2)
- **Density** — particle count (hard cap 3000)
- **Quality**
  - **Low** — lightest; bloom off
  - **Auto** — balanced (default after intro)
  - **High** — stronger bloom; heavier
- **Stroke** — trail length: Ink / Balanced / Spark
- **Replay Intro** — play the wake-up sequence again
- **Light Mode** — safe preset if the machine stutters

## Tips

If FPS stays yellow / low: use **Light Mode**, or lower Density / Quality.
