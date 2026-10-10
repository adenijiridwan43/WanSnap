// Renders the app icons to PNG using headless Chrome, so the shipped files are
// always an exact match for dev-tools/icons.html.
//
// Run with:  node scripts/generate-icons.mjs
// Only needed when the mark changes; the generated PNGs are committed.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const source = join(root, 'dev-tools', 'icons.html');

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
  console.error('No Chrome or Edge binary found. Open dev-tools/icons.html and export manually.');
  process.exit(1);
}

const targets = [
  { id: 'i192', name: 'icon-192.png', size: 192 },
  { id: 'i512', name: 'icon-512.png', size: 512 },
];

const work = mkdtempSync(join(tmpdir(), 'wansnap-icons-'));

for (const { id, name, size } of targets) {
  // Each icon is captured from a page that shows only that icon, so the
  // screenshot has no padding, chrome or scrollbars.
  const page = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#FFF8F2;overflow:hidden}</style>
${readSvg(id, size)}`;

  const htmlPath = join(work, `${name}.html`);
  writeFileSync(htmlPath, page);

  execFileSync(
    browser,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--screenshot=${join(publicDir, name)}`,
      `--window-size=${size},${size}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: 'ignore' }
  );
  console.log(`wrote ${name} (${size}x${size})`);
}

rmSync(work, { recursive: true, force: true });

function readSvg(id, size) {
  const html = readFileSync(source, 'utf8');
  const match = html.match(new RegExp(`<svg[^>]*id="${id}"[\\s\\S]*?</svg>`));
  if (!match) throw new Error(`svg #${id} not found in ${source}`);
  return match[0].replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`);
}