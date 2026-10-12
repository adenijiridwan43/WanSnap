# WanSnap

**Turn any video into high-quality screenshots — without uploading a thing.**

WanSnap runs entirely in your browser. Your video never leaves your device,
there is no account to create, no queue to wait in, and no watermark.

```bash
npm install
npm run dev       # http://localhost:5173
```

> Use `npm.cmd` instead of `npm` in PowerShell if script execution is disabled.

---

## Why WanSnap

Most video-to-screenshot tools make you upload the file first. That means
waiting, and it means handing a copy of your footage to somebody else's server.
Whether that footage is a client deliverable, a private recording, or something
you simply would rather not put on a third party's hard drive, that is a
trade-off you should not have to make to grab a few stills.

WanSnap runs [FFmpeg](https://ffmpeg.org/) compiled to WebAssembly inside the
page. The file is read with the browser's own file APIs, processed locally, and
the resulting images are handed straight back to you as a ZIP.

| | WanSnap | Typical online converter |
|---|---|---|
| Video leaves your device | Never | Uploaded to a server |
| Works offline | Yes, after first load | No |
| Account required | No | Often |
| Watermark | None | Frequently |
| File size ceiling | Bounded by your RAM | Server limits |

---

## What it does

- **Frame capture** — pull one still per second, or fine-tune the rate
- **Trim first** — only capture the range you actually care about
- **Exact timestamps** — grab specific moments instead of sampling evenly
- **Deduplicate** — collapse near-identical frames so a static scene yields a
  handful of shots instead of hundreds
- **Compare** — filter the grid down to the frames worth keeping
- **Export** — download everything, or just your selection, as a ZIP

Captured frames land in a full-screen viewer with keyboard navigation
(<kbd>←</kbd>/<kbd>→</kbd> to move, <kbd>Esc</kbd> to close, <kbd>I</kbd> to
toggle the caption) and a one-click download for any single frame.

Your last capture is kept on the device, so a page reload never costs you a
re-run.

---

## Settings

Everything is configurable from the gear icon and persists between sessions.

| Setting | Range | Notes |
|---|---|---|
| Frames per second | 0.1 – 10 | Higher is slower and uses more memory. |
| Quality | 1 – 31 | For JPG and WEBP. PNG is lossless and ignores this. |
| Format | JPG / PNG / WEBP | |
| Maximum video length | 1 – 3600 s | Longer videos are rejected before processing. |
| Frame cap | 1 – 2000 | Hard limit that protects memory. |
| Trim range | any window | Capture part of a video only. |
| Custom timestamps | up to 100 | Accepts `12`, `0:05` or `1:02:30`. |
| Remove similar frames | on / off | Plus an adjustable similarity threshold. |

---

## Built for

- **Creators** pulling reference stills from long recordings
- **Developers** grabbing a frame for a bug report or a README
- **Educators** pulling slides out of a lecture
- **Anyone** who needs one specific frame and does not want to upload a
  500 MB file to do it

---

## Requirements

- Node 20 or newer
- A browser with `SharedArrayBuffer` — Chrome, Edge, Firefox, or Safari 16.4+

---

## Deployment

FFmpeg's WASM build needs the page to be **cross-origin isolated**. Without
these headers `SharedArrayBuffer` is unavailable and every capture fails.

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
```

`vercel.json` and `public/_headers` (Netlify / Cloudflare Pages) already carry
them. On any other host, add them yourself.

Two more things worth knowing before you deploy:

- **`ffmpeg-core.wasm` is ~30 MB** and is served from `public/ffmpeg`. It is
  fetched on demand the first time someone processes a video, not up front.
- **The page is cross-origin isolated**, which means any third-party subresource
  must send CORP headers or it will be blocked. That is why no web font is
  loaded from a CDN; the system font stack is used instead.

---

## Under the hood

- **React + TypeScript + Vite**, no UI framework
- **FFmpeg.wasm** for decoding and frame extraction
- **IndexedDB** for session persistence, storing frames as Blobs
- **Service worker** for offline shell and installability
- **JSZip** for exports

Everything is hand-written CSS built on a token system in `src/index.css`;
there is no component library and no CSS-in-JS.

```bash
npm run build     # production bundle
npm run preview   # serve it locally, headers intact
npm run lint      # ESLint
npm run verify    # confirm the FFmpeg core is in place
```

Branding assets are generated rather than hand-drawn, so the committed PNGs
cannot drift from their source:

```bash
node scripts/generate-icons.mjs
node scripts/generate-og-image.mjs
```

Edit `dev-tools/icons.html` or `dev-tools/og-image.html` first.

---

## Licence

MIT