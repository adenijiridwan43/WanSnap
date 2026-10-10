// Renders the Open Graph card to public/og-image.png using headless Chrome.
//
// Run with:  node scripts/generate-og-image.mjs
// Only needed when the card design changes; the PNG is committed.
//
// The card itself lives in dev-tools/og-image.html so the design can be edited
// as HTML/CSS and the exported PNG always matches what ships.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const source = join(root, 'dev-tools', 'og-image.html');

const WIDTH = 1200;
const HEIGHT = 630;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const browser = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge binary found. Open dev-tools/og-image.html and export manually.');
  process.exit(1);
}

const html = readFileSync(source, 'utf8');

// Capture just the .card element, with the helper chrome and page padding
// removed so the PNG is exactly the share image.
const page = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;overflow:hidden}
  body{display:inline-block}
</style>${html.replace(/<div class="actions">[\s\S]*?<\/div>\s*<\/div>/, '</div>')}`;

const work = mkdtempSync(join(tmpdir(), 'wansnap-og-'));
const htmlPath = join(work, 'og.html');
writeFileSync(htmlPath, page);

execFileSync(
  browser,
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    `--screenshot=${join(publicDir, 'og-image.png')}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    pathToFileURL(htmlPath).href,
  ],
  { stdio: 'ignore' }
);

rmSync(work, { recursive: true, force: true });
console.log(`wrote og-image.png (${WIDTH}x${HEIGHT})`);