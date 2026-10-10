// src/utils/ffmpeg.ts
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { Frame, ProcessingOptions, ProcessingProgress } from '../types';

export class CancelledError extends Error {
  constructor() {
    super('Processing cancelled');
    this.name = 'CancelledError';
  }
}

const INPUT = 'input.mp4';
const OUT_DIR = '/frames';

/**
 * Frames produced per ffmpeg pass.
 *
 * MEMFS has a fixed ceiling; a single pass that writes every frame before any
 * is read back is what stalled the tab on longer captures. Slicing the capture
 * into chunks of this size keeps peak memory flat regardless of clip length.
 */
const CHUNK_FRAMES = 40;

class FFmpegService {
  private ffmpeg: FFmpeg;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private controller: AbortController | null = null;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  async load(onLoadProgress?: (ratio: number) => void): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = this.doLoad(onLoadProgress);
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async doLoad(onLoadProgress?: (ratio: number) => void): Promise<void> {
    // The worker is registered with `type: "module"`, so `importScripts` is
    // unavailable and the core is pulled in via `await import()`. That only works
    // with the ESM build - the UMD build has no default export and fails with
    // "failed to import ffmpeg-core.js".
    const base = `${window.location.origin}/ffmpeg`;
    const cdn = 'https://unpkg.com/@ffmpeg/core@0.12.2/dist/esm';

    const attempt = async (root: string) => {
      onLoadProgress?.(0.1);
      // toBlobURL mirrors the asset into a blob so the worker is not blocked by
      // cross-origin rules under COOP/COEP isolation.
      const coreURL = await toBlobURL(`${root}/ffmpeg-core.js`, 'text/javascript');
      onLoadProgress?.(0.5);
      const wasmURL = await toBlobURL(`${root}/ffmpeg-core.wasm`, 'application/wasm');
      onLoadProgress?.(0.8);
      await this.ffmpeg.load({ coreURL, wasmURL });
    };

    try {
      await attempt(base);
      this.loaded = true;
      onLoadProgress?.(1);
    } catch (localError) {
      console.warn('Local FFmpeg core failed, trying CDN fallback:', localError);
      try {
        this.ffmpeg = new FFmpeg();
        await attempt(cdn);
        this.loaded = true;
        onLoadProgress?.(1);
      } catch (cdnError) {
        console.error('FFmpeg failed to load from both local and CDN:', cdnError);
        throw new Error(
          'Video processing tools failed to load. This page must be cross-origin isolated ' +
            '(COOP/COEP headers). If you are running it locally, use "npm run dev" or ' +
            '"npm run preview" rather than opening the file directly.'
        );
      }
    }
  }

  /**
   * Reads the duration with ffprobe. Used when the HTML5 <video> probe reports 0,
   * which happens for valid files whose metadata the browser will not surface.
   */
  async probeDuration(file: File): Promise<number | null> {
    await this.load();
    await this.ffmpeg.writeFile('probe.mp4', new Uint8Array(await file.arrayBuffer()));

    // This core build ships without ffprobe, so the duration is taken from
    // ffmpeg's own stderr banner ("Duration: 00:00:08.00") instead.
    let duration: number | null = null;
    const handler = ({ message }: { message: string }) => {
      const match = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return;
      const [, h, m, s] = match;
      duration = Number(h) * 3600 + Number(m) * 60 + Number(s);
    };

    this.ffmpeg.on('log', handler);
    try {
      // Decoding a single frame is enough to make ffmpeg print the header.
      await this.ffmpeg.exec(['-i', 'probe.mp4', '-frames:v', '1', '-f', 'null', '-']);
      return duration && duration > 0 ? duration : null;
    } catch (error) {
      console.warn('[ffmpeg] probeDuration failed:', error);
      return null;
    } finally {
      this.ffmpeg.off('log', handler);
      await this.ffmpeg.deleteFile('probe.mp4').catch(() => undefined);
    }
  }

  /**
   * Builds a synthetic clip from lavfi. Exists so the self test can obtain a
   * seekable fixture without a second WASM core competing for memory.
   */
  async makeRawVideo(seconds: number): Promise<number> {
    await this.load();
    await this.ffmpeg.writeFile('raw.mp4', new Uint8Array());
    return this.ffmpeg.exec([
      '-f', 'lavfi',
      '-i', `testsrc=size=320x240:rate=10:duration=${seconds}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      // Without faststart the moov atom lands at the end of the file, so the
      // HTML5 <video> probe cannot read the duration and reports 0.
      '-movflags', '+faststart',
      'raw.mp4',
    ]);
  }

  async takeRawVideo(): Promise<File> {
    const data = await this.ffmpeg.readFile('raw.mp4');
    return new File([data as BlobPart], 'test.mp4', { type: 'video/mp4' });
  }

  async clearRawVideo(): Promise<void> {
    await this.ffmpeg.deleteFile('raw.mp4').catch(() => undefined);
  }

  /** Test helper: runs a raw ffmpeg command against the loaded core. */
  async execRaw(args: string[]): Promise<number> {
    await this.load();
    return this.ffmpeg.exec(args);
  }

  /** Test helper: pulls a file out of MEMFS as a File. */
  async takeRaw(name: string, type: string): Promise<File> {
    await this.load();
    const data = await this.ffmpeg.readFile(name);
    return new File([data as BlobPart], name, { type });
  }

  /** Test helper: inspects MEMFS contents without disturbing the app. */
  async inspectDir(path: string): Promise<{ name: string; isDir: boolean; size: number }[]> {
    await this.load();
    const entries = await this.ffmpeg.listDir(path).catch(() => []);
    const out: { name: string; isDir: boolean; size: number }[] = [];
    for (const e of entries) {
      let size = 0;
      if (!e.isDir) {
        const data = await this.ffmpeg
          .readFile(`${path === '/' ? '' : path}/${e.name}`)
          .catch(() => null);
        size = data instanceof Uint8Array ? data.byteLength : 0;
      }
      out.push({ name: e.name, isDir: e.isDir, size });
    }
    return out;
  }

  /** Requests cancellation. The in-flight exec rejects and cleans up. */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }

  private throwIfCancelled(): void {
    if (this.controller?.signal.aborted) throw new CancelledError();
  }

  async processVideo(
    file: File,
    duration: number,
    options: ProcessingOptions,
    onProgress: (progress: ProcessingProgress) => void
  ): Promise<Frame[]> {
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;

    try {
      onProgress({ phase: 'loading', percentage: 0, currentFrame: 0, totalFrames: 0 });
      await this.load((ratio) => {
        if (!signal.aborted) {
          onProgress({ phase: 'loading', percentage: ratio * 5, currentFrame: 0, totalFrames: 0 });
        }
      });
      this.throwIfCancelled();

      if (!(duration > 0)) {
        throw new Error('Could not determine the video length, so frames cannot be captured.');
      }

      const fileData = new Uint8Array(await file.arrayBuffer());
      await this.ffmpeg.writeFile(INPUT, fileData, { signal });
      await this.ffmpeg.createDir(OUT_DIR, { signal }).catch(() => undefined);
      this.throwIfCancelled();

      const ext = options.format;
      const total = Math.max(
        1,
        options.customTimestamps?.length ??
          Math.floor((options.trimEnd ?? duration) * options.fps) + 1
      );

      const frames = options.customTimestamps?.length
        ? await this.captureCustom(options.customTimestamps, ext, options, onProgress, signal, total)
        : await this.captureUniform(duration, ext, options, onProgress, signal, total);

      this.throwIfCancelled();
      onProgress({ phase: 'done', percentage: 100, currentFrame: frames.length, totalFrames: frames.length });
      return frames;
    } catch (error) {
      if (error instanceof CancelledError || signal.aborted) throw new CancelledError();
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
      await this.cleanup(signal).catch(() => undefined);
    }
  }

  /** Even fps sampling across the (optionally trimmed) video. */
  private async captureUniform(
    duration: number,
    ext: string,
    options: ProcessingOptions,
    onProgress: (p: ProcessingProgress) => void,
    signal: AbortSignal,
    total: number
  ): Promise<Frame[]> {
    const start = Math.max(0, options.trimStart);
    const end = Math.min(duration, options.trimEnd ?? duration);
    const span = Math.max(0, end - start);

    if (span <= 0) {
      throw new Error('The trim range is empty. Set an end time later than the start.');
    }

    // MEMFS is a fixed-size in-memory filesystem, and writing every frame into it
    // before reading any back is what made long captures stall the tab: the
    // decode pass completes, the filesystem fills, and the worker stops
    // responding with no error to show. Working in bounded time slices keeps
    // peak usage flat and lets frames stream out as they are produced.
    const chunkSeconds = Math.max(5, Math.ceil(CHUNK_FRAMES / options.fps));
    const chunks: Array<{ from: number; to: number }> = [];
    for (let cursor = start; cursor < end; cursor += chunkSeconds) {
      chunks.push({ from: cursor, to: Math.min(end, cursor + chunkSeconds) });
    }

    const frames: Frame[] = [];

    for (let c = 0; c < chunks.length; c++) {
      this.throwIfCancelled();
      const { from, to } = chunks[c];
      // Frames are numbered from 1 by ffmpeg within each chunk; the absolute index
      // is recovered from the timestamp once the sample grid is snapped.

      const args: string[] = ['-i', INPUT];

      // `-ss` and `-t` are both absolute positions in the input file, so they
      // are measured from the start of the video, not from the trim point.
      //
      // Each chunk seeks a quarter of a frame *before* its window: `fps=N`
      // samples from the first frame at or after the seek point, so landing
      // exactly on the boundary drops the frame at that instant and a trim
      // range loses its final second. Frames that fall before the window are
      // discarded in collect(), which removes the duplication this causes.
      const seekLead = 1 / (options.fps * 4);
      const decodeStart = Math.max(0, from - seekLead);

      if (decodeStart > 0) args.push('-ss', decodeStart.toFixed(3));
      args.push('-t', (to - decodeStart).toFixed(3));
      args.push('-vf', `fps=${options.fps}`);
      if (ext === 'jpg') args.push('-q:v', String(options.quality));
      args.push(`${OUT_DIR}/f_%d.${ext}`);

      // Progress is measured across the whole capture, not per chunk. The slice
      // keeps the running total strictly increasing and within 0-100.
      const chunkShare = 70 / chunks.length;
      this.trackProgress(
        onProgress,
        signal,
        total,
        from,
        to,
        5 + c * chunkShare,
        Math.round(c * total / chunks.length)
      );

      const code = await this.ffmpeg.exec(args, undefined, { signal });
      this.throwIfCancelled();

      if (code !== 0) {
        // A chunk that fails is usually memory pressure; surface it instead of
        // silently returning a short capture that looks like success.
        console.error('[ffmpeg] chunk failed', code, `window ${from}-${to}`, args.join(' '));
        if (frames.length === 0) {
          throw new Error(`Failed to extract frames from the video (ffmpeg exit ${code}).`);
        }
        break;
      }

      const collected = await this.collect(
        (p) => onProgress(p),
        ext,
        signal,
        from,
        to,
        options.fps,
        total,
        decodeStart
      );
      frames.push(...collected);

      // Free each chunk immediately rather than holding every frame in MEMFS
      // until the end of the capture.
      await this.clearOutDir(signal);

      onProgress({
        phase: 'reading',
        percentage: 5 + ((c + 1) / chunks.length) * 70,
        currentFrame: frames.length,
        totalFrames: total,
      });
    }

    if (frames.length === 0) {
      throw new Error('No frames could be extracted from the video.');
    }

    return frames.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Deletes everything currently in the output directory. */
  private async clearOutDir(signal: AbortSignal): Promise<void> {
    const entries = await this.ffmpeg
      .listDir(OUT_DIR, { signal })
      .catch(() => [] as { name: string; isDir: boolean }[]);
    for (const entry of entries) {
      if (!entry.isDir) {
        await this.ffmpeg.deleteFile(`${OUT_DIR}/${entry.name}`, { signal }).catch(() => undefined);
      }
    }
  }

  /**
   * Explicit timecodes. Each needs its own exec for a precise seek, so this is
   * linear in the number of stamps and capped by the caller.
   */
  private async captureCustom(
    timestamps: number[],
    ext: string,
    options: ProcessingOptions,
    onProgress: (p: ProcessingProgress) => void,
    signal: AbortSignal,
    total: number
  ): Promise<Frame[]> {
    const frames: Frame[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      this.throwIfCancelled();
      const stamp = timestamps[i];
      const name = `${OUT_DIR}/c_${i}.${ext}`;

      const args: string[] = ['-ss', stamp.toFixed(3), '-i', INPUT, '-frames:v', '1'];
      if (ext === 'jpg') args.push('-q:v', String(options.quality));
      args.push(name);

      const code = await this.ffmpeg.exec(args, undefined, { signal });
      if (code !== 0) continue;

      const data = await this.ffmpeg.readFile(name).catch(() => null);
      await this.ffmpeg.deleteFile(name, { signal }).catch(() => undefined);
      if (!data || data === 'EOF') continue;

      frames.push({
        id: `frame-${frames.length}-${stamp.toFixed(3)}`,
        url: URL.createObjectURL(new Blob([data as Uint8Array], { type: `image/${ext}` })),
        timestamp: stamp,
      });

      const done = i + 1;
      onProgress({
        phase: 'reading',
        percentage: 5 + (done / total) * 95,
        currentFrame: done,
        totalFrames: total,
        timeRemaining: ((timestamps.length - done) * 0.35) | 0,
      });
    }

    if (frames.length === 0) throw new Error('No frames could be captured at those timestamps.');
    return frames;
  }

  /**
   * Derives progress from `time` rather than the reported `progress` ratio: the
   * FFmpeg docs warn that ratio is only accurate when input and output lengths match,
   * which never holds for a video -> image sequence.
   */
  private trackProgress(
    onProgress: (p: ProcessingProgress) => void,
    signal: AbortSignal,
    total: number,
    start: number,
    end: number,
    basePercentage: number,
    baseCurrentFrame: number
  ) {
    const span = Math.max(0.001, end - start);
    const handler = ({ time }: { time: number }) => {
      if (signal.aborted) return;
      const seconds = Math.max(0, time / 1_000_000 - start);
      const ratio = Math.min(1, seconds / span);
      onProgress({
        phase: 'decoding',
        percentage: Math.min(99, basePercentage + ratio * 70),
        currentFrame: Math.min(total, Math.round(baseCurrentFrame + ratio * total)),
        totalFrames: total,
        timeRemaining: Math.max(0, Math.round((1 - ratio) * span * 0.5)),
      });
    };
    this.ffmpeg.on('progress', handler);
    // Detach once exec settles, whichever way it goes.
    signal.addEventListener('abort', () => this.ffmpeg.off('progress', handler), { once: true });
    this.pendingDetachers.push(() => this.ffmpeg.off('progress', handler));
  }

  private pendingDetachers: Array<() => void> = [];

  /** Reads produced files off MEMFS by listing the dir instead of guessing indices. */
  private async collect(
    onProgress: (p: ProcessingProgress) => void,
    ext: string,
    signal: AbortSignal,
    /** Start of this chunk's window; frames landing before it are dropped. */
    startOffset: number,
    /** Exclusive end of this chunk's window. */
    windowEnd: number,
    fps: number,
    total: number,
    /** Absolute time the seek started at, which anchors the sample grid. */
    chunkSeekStart: number
  ): Promise<Frame[]> {
    const entries = await this.ffmpeg.listDir(OUT_DIR, { signal }).catch(() => [] as { name: string; isDir: boolean }[]);
    const names = entries
      .map((e) => e.name)
      // Must match the full name: the directory also reports "." and "..",
      // which would otherwise pass a naive suffix check and break every read.
      .filter((name) => new RegExp(`^f_\\d+\\.${ext}$`, 'i').test(name))
      .sort((a, b) => Number(a.match(/_(\d+)\./)![1]) - Number(b.match(/_(\d+)\./)![1]));

    const frames: Frame[] = [];
    for (let i = 0; i < names.length; i++) {
      this.throwIfCancelled();
      const data = await this.ffmpeg.readFile(`${OUT_DIR}/${names[i]}`).catch((e) => {
        // Do not swallow this: a failed read is a real error, and silently
        // skipping it previously made a working extraction look empty.
        console.error('[ffmpeg] failed to read', names[i], e);
        return null;
      });
      if (!data || data === 'EOF') continue;

      // Even fps spacing means index maps directly to time. The chunk's start
      // offset places the label in the source video, not in the trimmed range.
      const index = Number(names[i].match(/_(\d+)\./)?.[1] ?? i + 1);

      // `fps=N` samples on an exact grid anchored at the seek point, so the
      // frame with index k sits at `seekStart + k/fps`. Snapping back onto the
      // global grid (multiples of 1/fps from the capture start) removes the
      // sub-frame error the overshoot would otherwise bake into every label.
      const raw = chunkSeekStart + (index - 1) / fps;
      const snapped = Math.round(raw * fps) / fps;

      // Keep only frames belonging to this chunk's window. A half-frame tolerance on
      // the upper bound includes the frame exactly at `windowEnd` (which the
      // overshoot makes reachable) while still rejecting the next chunk's first
      // frame, so seams neither duplicate nor drop.
      const tolerance = 1 / (2 * fps);
      if (snapped < startOffset - 1e-6 || snapped >= windowEnd + tolerance) {
        continue;
      }

      const absolute = Math.round(snapped * fps);

      frames.push({
        id: `frame-${absolute}-${snapped.toFixed(3)}`,
        url: URL.createObjectURL(new Blob([data as Uint8Array], { type: `image/${ext}` })),
        timestamp: snapped,
      });

      onProgress({
        phase: 'reading',
        percentage: Math.min(99, 5 + ((absolute + 1) / Math.max(1, total)) * 70),
        currentFrame: absolute + 1,
        totalFrames: total,
      });
    }

    if (frames.length === 0) {
      console.error('[ffmpeg] listDir found', entries.length, 'entries:', JSON.stringify(entries));
      throw new Error('No frames could be extracted from the video.');
    }
    return frames;
  }

  private async cleanup(signal: AbortSignal): Promise<void> {
    for (const detach of this.pendingDetachers.splice(0)) detach();
    await this.ffmpeg.deleteFile(INPUT, { signal }).catch(() => undefined);
    await this.clearOutDir(signal);
    await this.ffmpeg.deleteDir(OUT_DIR, { signal }).catch(() => undefined);
  }
}

export const ffmpegService = new FFmpegService();