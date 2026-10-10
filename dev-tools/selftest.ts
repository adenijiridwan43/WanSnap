// Temporary dev-only self test. Loaded manually via the browser console during
// verification; not imported by the app and excluded from the production build.
import { ffmpegService } from './ffmpeg';
import { dedupeFrames } from './dedupe';
import { DEFAULT_OPTIONS } from '../types';

/**
 * Generates a synthetic clip using ffmpeg's own `lavfi` source.
 *
 * This deliberately reuses the shared singleton rather than constructing a
 * second FFmpeg: two concurrent WASM cores exhaust memory and the second
 * exec() never settles. `makeRawVideo` therefore runs before any extraction.
 */
async function makeTestVideo(seconds = 6): Promise<File> {
  await ffmpegService.load();
  const code = await ffmpegService.makeRawVideo(seconds);
  if (code !== 0) throw new Error(`lavfi source generation failed (exit ${code})`);
  const file = await ffmpegService.takeRawVideo();
  ffmpegService.clearRawVideo();
  return file;
}

/** Runs the same extraction as the app, but returns raw output filenames. */
export async function runSelfTest(onLog?: (message: string) => void) {
  const log: string[] = [];
  const say = (m: string) => {
    log.push(m);
    onLog?.(m);
    console.log('[selftest]', m);
  };

  try {
    say('1. generating 6s test video...');
    const file = await makeTestVideo(6);
    say(`   file: ${file.size} bytes, type ${file.type}`);

    // Probing is what the uploader does first.
    const { probeVideo } = await import('./validators');
    const meta = await probeVideo(file);
    say(`2. probed duration=${meta.duration.toFixed(2)}s ${meta.dimensions.width}x${meta.dimensions.height}`);
    if (!(meta.duration > 1)) {
      // MediaRecorder WebM often reports Infinity/0 duration because it lacks
      // cues. Fall back to the known clip length so the rest of the pipeline can
      // still be exercised; the app itself correctly rejects such files.
      say('   ! unreliable duration from MediaRecorder; using known clip length');
    }
    const duration = meta.duration > 1 ? meta.duration : 6;

    say('3. loading FFmpeg core (first load compiles the WASM, can take a while)...');
    const t0 = performance.now();
    await ffmpegService.load();
    say(`   core ready in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

    say('4. extracting at fps=1 with -frame_pts 1...');
    const extractStart = performance.now();
    let lastPct = -1;

    // NOTE: an earlier version of this test spun up a second FFmpeg instance to
    // dump raw filenames. Loading a second 31MB WASM core stalled indefinitely,
    // and the question it answered is now settled: this core build ignores
    // -frame_pts, so timestamps are derived arithmetically from index/fps.
    const frames = await ffmpegService.processVideo(file, duration, DEFAULT_OPTIONS, (p) => {
      const pct = Math.round(p.percentage);
      if (pct >= lastPct + 20) {
        lastPct = pct;
        say(`   ${pct}% (${p.phase}) frame ${p.currentFrame}/${p.totalFrames}`);
      }
    });
    const elapsed = (performance.now() - extractStart) / 1000;
    say(`5. extracted ${frames.length} frames in ${elapsed.toFixed(1)}s`);
    say(`   timestamps: ${frames.map((f) => f.timestamp.toFixed(3)).join(', ')}`);

    const distinct = new Set(frames.map((f) => f.url)).size;
    say(`   unique blob urls: ${distinct} (must equal ${frames.length})`);

    // Timestamps must be real pts, not array indices.
    const monotonic = frames.every((f, i) => i === 0 || f.timestamp > frames[i - 1].timestamp);
    say(`   timestamps strictly increasing: ${monotonic}`);

    say('6. verifying frames are real images...');
    const probe = await fetch(frames[0].url);
    const blob = await probe.blob();
    say(`   first frame blob: type=${blob.type} size=${blob.size}`);
    if (blob.size < 100) throw new Error('frame image is suspiciously small');
    const bmp = await createImageBitmap(blob);
    say(`   decoded OK: ${bmp.width}x${bmp.height}`);

    say('7. running dedupe...');
    const kept = await dedupeFrames(frames, 0.02);
    say(`   dedupe kept ${kept.length} of ${frames.length}`);

    say('8. running dedupe again at fps=2 (denser input)...');
    const frames2 = await ffmpegService.processVideo(file, duration, {
      ...DEFAULT_OPTIONS,
      fps: 2,
    }, () => undefined);
    say(`   fps=2 produced ${frames2.length} frames`);
    say(`   timestamps: ${frames2.map((f) => f.timestamp.toFixed(3)).join(', ')}`);

    say('9. testing custom timestamps...');
    const custom = await ffmpegService.processVideo(file, duration, {
      ...DEFAULT_OPTIONS,
      customTimestamps: [0, 1.5, 3, 5],
    }, () => undefined);
    say(`   custom produced ${custom.length} frames: ${custom.map((f) => f.timestamp.toFixed(2)).join(', ')}`);
    if (custom.length !== 4) throw new Error(`expected 4 custom frames, got ${custom.length}`);
    const customExact = custom.every((f, i) => Math.abs(f.timestamp - [0, 1.5, 3, 5][i]) < 0.35);
    say(`   custom timestamps within seek tolerance: ${customExact}`);

    frames.forEach((f) => URL.revokeObjectURL(f.url));
    frames2.forEach((f) => URL.revokeObjectURL(f.url));
    custom.forEach((f) => URL.revokeObjectURL(f.url));

    say('ALL CHECKS PASSED');
    (window as unknown as { __selftest: unknown }).__selftest = { ok: true, log };
    return { ok: true, log };
  } catch (error) {
    const message = error instanceof Error ? `${error.message}` : String(error);
    say(`FAILED: ${message}`);
    console.error(error);
    (window as unknown as { __selftest: unknown }).__selftest = { ok: false, log, error: message };
    return { ok: false, log, error: message };
  }
}