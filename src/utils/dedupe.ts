// src/utils/dedupe.ts
import { Frame } from '../types';

/** Downscale target. Small enough to be fast, large enough to catch real change. */
const SIG_SIZE = 16;

/** Upper bound on a single frame decode, so one bad frame cannot stall the pass. */
const DECODE_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Mean absolute difference between two grayscale signatures, normalised to 0-1.
 * 0 means identical; 1 means completely different.
 */
function signatureDistance(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(a[i] - b[i]);
  }
  return total / (a.length * 255);
}

/** Renders a frame to a 16x16 grayscale signature. */
async function signatureFor(frame: Frame): Promise<Uint8Array> {
  // createImageBitmap is the most reliable decode path for blob URLs, but it can
  // hang on some inputs, so it is bounded. A hung decode previously froze the
  // whole dedupe pass with no error and no progress.
  const blob = await fetch(frame.url).then((r) => r.blob());
  const bitmap = await withTimeout(createImageBitmap(blob), DECODE_TIMEOUT_MS, 'frame decode timed out');

  const canvas = document.createElement('canvas');
  canvas.width = SIG_SIZE;
  canvas.height = SIG_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');

  ctx.drawImage(bitmap, 0, 0, SIG_SIZE, SIG_SIZE);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, SIG_SIZE, SIG_SIZE);

  const gray = new Uint8Array(SIG_SIZE * SIG_SIZE);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Drops frames that look near-identical to the last frame we kept.
 *
 * A static scene should yield a handful of frames, not 240. The first frame is
 * always kept, and each candidate is compared against the last *kept* frame so
 * a slow pan does not chain its way through every frame.
 */
export async function dedupeFrames(
  frames: Frame[],
  threshold: number,
  onProgress?: (kept: number, examined: number) => void
): Promise<Frame[]> {
  if (frames.length < 2) return frames;

  const kept: Frame[] = [];
  let lastSignature: Uint8Array | null = null;

  for (let i = 0; i < frames.length; i++) {
    let signature: Uint8Array;
    try {
      signature = await signatureFor(frames[i]);
    } catch (error) {
      // If a frame will not decode we cannot judge it; keep it rather than
      // silently dropping the user's content.
      console.warn('[dedupe] keeping undecodable frame', frames[i].id, error);
      kept.push(frames[i]);
      lastSignature = null;
      onProgress?.(kept.length, i + 1);
      continue;
    }

    if (lastSignature === null || signatureDistance(lastSignature, signature) > threshold) {
      kept.push(frames[i]);
      lastSignature = signature;
    }

    onProgress?.(kept.length, i + 1);
    // Yield periodically so a few hundred frames do not lock up the UI thread.
    if (i % 8 === 0) await nextTick();
  }

  return kept;
}