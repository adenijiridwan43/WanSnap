# WanSnap

Turn a video into a grid of still frames, entirely in the browser. Nothing is
uploaded to a server — FFmpeg runs as WebAssembly inside the page.

## What it does

- Drop in a video (up to 4 minutes by default) and get one frame per second
- Pick the frames you want, then download them all or a selection as a ZIP
- Everything runs locally, so nothing leaves the device

## Requirements

- Node 20 or newer
- A browser with `SharedArrayBuffer` (Chrome, Edge, Firefox, Safari 16.4+)

> Use `npm.cmd` instead of `npm` in PowerShell if script execution is disabled.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle into dist/
npm run preview  # serve the build locally (keeps the required headers)
```

## Settings

Everything is configurable from the gear icon and persists between sessions:

| Setting | Notes |
|---|---|
| Frames per second | 0.1–10. Higher is slower and uses more memory. |
| Quality | 1–31 for JPG/WEBP. PNG is lossless and ignores this. |
| Format | JPG, PNG or WEBP. |
| Maximum length | Videos longer than this are rejected up front. |
| Frame cap | Hard limit that protects memory. |
| Trim range | Only capture part of the video. |
| Custom timestamps | Capture exact moments (`0:05, 1:20`) instead of even sampling. |
| Remove similar frames | Drops near-duplicates so static scenes stay short. |

Tapping a frame opens a full-screen viewer (arrow keys to move, `Esc` to close,
`i` to toggle the caption) with a download button for that single frame.

## Deployment

FFmpeg's WASM build needs the page to be **cross-origin isolated**. Without these
headers `SharedArrayBuffer` is unavailable and every frame capture fails.

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

`vercel.json` and `public/_headers` (Netlify / Cloudflare Pages) already carry
them. If you host elsewhere, add them yourself.

`ffmpeg-core.wasm` is about 30 MB and is served from `public/ffmpeg`. Copy it
from `@ffmpeg/core`'s **`dist/esm`** build — the UMD build has no default export
and fails to load in a module worker.

Because the page is isolated, cross-origin subresources need CORP headers too.
That is why the web font is not loaded from a CDN; the system font stack is used
instead.

## Development tools

`dev-tools/` holds a self-test that exercises the real pipeline against a
generated clip: frame extraction, timestamp accuracy, custom seeks and dedupe.
It is intentionally outside `src/` so it never ships in a production bundle.

## Licence

MIT