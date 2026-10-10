# WanSnap

Turn a video into a grid of still frames, entirely in the browser. Nothing is
uploaded to a server — FFmpeg runs as WebAssembly inside the page.

## What it does

- Drop in a video (up to 4 minutes by default) and get one frame per second
- Pick the frames you want, then download them all or a selection as a ZIP
- Everything runs locally, so nothing leaves the device
- Installable as an app and usable offline for the shell
- Your last capture is kept on the device, so a reload never costs a re-run

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

## Offline and installability

The app ships a service worker (`src/sw.ts`, built to `dist/sw.js`).

- The app shell is precached, so the app opens without a network connection.
- **The ~30 MB FFmpeg core is deliberately not precached.** Most visits never
  process a video, and precaching it would make installation unusably slow. It
  is fetched on demand the first time a video is processed, then served by the
  browser's HTTP cache.
- Navigation requests are network-first so a deploy is picked up immediately;
  content-hashed build assets are cache-first because their URL changes on every
  build.

Bump `CACHE_VERSION` in `src/sw.ts` to invalidate everything on the next
activation.

## Sessions

A finished capture is written to IndexedDB as Blobs (not base64, which would cost
a third in size), so closing or reloading the tab does not force the user to
re-process the video. The gallery shows a banner making the restore explicit and
offers "Start fresh" to clear it. Nothing is uploaded, and the data stays on the
device until the user clears it.

## Branding assets

The icons and social preview image are generated rather than hand-drawn, so they
cannot drift from the source:

```bash
node scripts/generate-icons.mjs     # public/icon-192.png, icon-512.png
node scripts/generate-og-image.mjs   # public/og-image.png
```

Edit `dev-tools/icons.html` or `dev-tools/og-image.html` first; both scripts
render those files with headless Chrome. Update `index.html` and
`public/sitemap.xml` with the real domain before going live.

## Development tools

`dev-tools/` holds the source for the branding assets plus a self-test that
exercises the real pipeline against a generated clip (frame extraction,
timestamp accuracy, custom seeks, dedupe) and one for the IndexedDB session
store. They are intentionally outside `src/` so they never ship in a production
bundle.

## Licence

MIT