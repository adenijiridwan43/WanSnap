// Copies the FFmpeg core into public/ so the app can serve it from its own
// origin (required under cross-origin isolation).
//
// The ESM build is mandatory: the worker is registered with `type: "module"`,
// so it loads the core via `await import()`. The UMD build has no default
// export and fails with "failed to import ffmpeg-core.js".
//
// Runs automatically on `npm install` (see the postinstall script).

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const target = join(root, 'public', 'ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

const check = process.argv.includes('--check');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(source))) {
    console.error(
      '[@ffmpeg/core] is not installed. Run "npm install" first, then this script again.'
    );
    process.exit(1);
  }

  if (check) {
    let missing = false;
    for (const name of files) {
      if (!(await exists(join(target, name)))) {
        console.error(`missing: public/ffmpeg/${name}`);
        missing = true;
      }
    }
    if (missing) process.exit(1);
    console.log('FFmpeg core is in place.');
    return;
  }

  await mkdir(target, { recursive: true });
  for (const name of files) {
    await copyFile(join(source, name), join(target, name));
  }
  console.log('Copied FFmpeg core (ESM) into public/ffmpeg.');
}

main().catch((error) => {
  console.error('Failed to copy the FFmpeg core:', error.message);
  process.exit(1);
});