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
 * Upper bound on a single ffmpeg pass.
 *
 * exec() can fail to settle when the worker exhausts memory, which looks to the
 * user like an indefinite freeze. Timing out turns that into a real error.
 */
const EXEC_TIMEOUT_MS = 15 * 60_000;

/**
 * Largest source file we will load into MEMFS.
 *
 * The source is held in the same in-memory filesystem as the output frames, so
 * a very large file is what actually exhausts it. Refusing early with a clear
 * message beats a tab that stops responding.
 */
const MAX_INPUT_BYTES = 400 * 1024 * 1024;

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

    // Keep the original extension. Writing every file as probe.mp4 is a lie
    // ffmpeg has to work around, and some demuxers refuse on it.
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'mp4';
    const name = `probe.${ext}`;
    await this.ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));

    // This core build ships without ffprobe, so the duration is read from
    // ffmpeg's own stderr banner, e.g. "Duration: 00:00:08.98".
    let duration: number | null = null;
    const handler = ({ message }: { message: string }) => {
      if (duration !== null) return;
      const match = message.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
      if (!match) return;
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      if (Number.isFinite(seconds) && seconds > 0) duration = seconds;
    };

    this.ffmpeg.on('log', handler);
    try {
      // Decoding a single frame is enough for ffmpeg to print the header, and
      // the null muxer discards the output so nothing is written.
      await this.ffmpeg.exec(['-i', name, '-frames:v', '1', '-f', 'null', '-']);
      return duration;
    } catch (error) {
      console.warn('[ffmpeg] probeDuration exec failed:', error);
      return null;
    } finally {
      this.ffmpeg.off('log', handler);
      await this.ffmpeg.deleteFile(name).catch(() => undefined);
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

  /** Test helper: captures ffmpeg's stderr log while running a command. */
  async execRawWithLogs(args: string[], onLog: (message: string) => void): Promise<number> {
    await this.load();
    const handler = ({ message }: { message: string }) => onLog(message);
    this.ffmpeg.on('log', handler);
    try {
      return await this.ffmpeg.exec(args);
    } finally {
      this.ffmpeg.off('log', handler);
    }
  }

  /** Test helper: writes raw bytes into MEMFS. */
  async writeRaw(name: string, data: Uint8Array): Promise<void> {
    await this.load();
    await this.ffmpeg.writeFile(name, data);
  }

  /** Test helper: pulls a file out of MEMFS as a File. */
  async takeRaw(name: string, type: string): Promise<File> {
    await this.load();
    const data = await this.ffmpeg.readFile(name);
    return new File([data as BlobPart], name, { type });
  }

  /** Test helper: empties the frame output directory. */
  async clearOutputForTest(): Promise<number> {
    await this.load();
    const entries = await this.ffmpeg.listDir(OUT_DIR).catch(() => []);
    let n = 0;
    for (const e of entries) {
      if (!e.isDir) {
        await this.ffmpeg.deleteFile(`${OUT_DIR}/${e.name}`).catch(() => undefined);
        n++;
      }
    }
    return n;
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

      // Check the size before touching MEMFS. The source and every output frame
      // share the same in-memory filesystem, so an oversized file makes the
      // worker stop responding partway through with nothing to show the user.
      if (file.size > MAX_INPUT_BYTES) {
        const mb = Math.round(file.size / (1024 * 1024));
        throw new Error(
          `That video is ${mb} MB, which is too large to process in the browser. ` +
            `Try a shorter clip, or lower the frame rate in Settings.`
        );
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

  /**
   * Even fps sampling across the (optionally trimmed) video.
   *
   * This is a single ffmpeg pass. Chunking was tried and removed: splitting the
   * capture forced repeated input seeks, and the work grew with the number of
   * chunks, which stalled longer captures at the seam. A single pass was
   * measured at 50 frames (720p), 60 frames (1080p) and 100 frames without
   * stalling, holding well under 10 MB of decoded frame data.
   *
   * The real ceiling is the size of the source file, which has to live in
   * MEMFS alongside the output frames. That is checked in processVideo before
   * any work starts.
   */
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

    const args: string[] = [];
    // `-ss` before `-i` is an input seek: ffmpeg jumps to the nearest keyframe
    // instead of decoding everything up to that point.
    if (start > 0) args.push('-ss', start.toFixed(3));
    args.push('-i', INPUT);
    if (span < duration) args.push('-t', span.toFixed(3));
    args.push('-vf', `fps=${options.fps}`);
    if (ext === 'jpg') args.push('-q:v', String(options.quality));
    args.push(`${OUT_DIR}/f_%d.${ext}`);

    this.trackProgress(onProgress, signal, total, start, end, 5, 0);

    // A watchdog: exec() can fail to settle when the worker runs out of memory,
    // which presented to the user as an indefinite freeze with no error. Fail
    // loudly instead so the message can be shown and the work cancelled.
    const code = await withTimeout(
      this.ffmpeg.exec(args, undefined, { signal }),
      EXEC_TIMEOUT_MS,
      'ffmpeg stopped responding'
    );

    this.throwIfCancelled();

    if (code !== 0) {
      console.error('[ffmpeg] exec failed', code, args.join(' '));
      throw new Error(`Failed to extract frames from the video (ffmpeg exit ${code}).`);
    }

    // `fps=N` spaces frames evenly, so frame i sits at start + i/N. That is
    // exact and avoids relying on -frame_pts, which this build ignores.
    return this.collect({ onProgress, ext, signal, start, end, fps: options.fps, total });
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
  private async collect(options: {
    onProgress: (p: ProcessingProgress) => void;
    ext: string;
    signal: AbortSignal;
    /** Absolute time in the source video that frame 1 corresponds to. */
    start: number;
    /** Exclusive end of the capture window. */
    end: number;
    fps: number;
    /** Expected frame count, for progress reporting. */
    total: number;
  }): Promise<Frame[]> {
    const { onProgress, ext, signal, start, end, fps, total } = options;

    const entries = await this.ffmpeg.listDir(OUT_DIR, { signal }).catch(() => [] as { name: string; isDir: boolean }[]);
    const names = entries
      .map((e) => e.name)
      // Must match the full name: the directory also reports "." and "..",
      // which would otherwise pass a naive suffix check and break every read.
      .filter((name) => new RegExp(`^f_\\d+\\.${ext}$`, 'i').test(name))
      .sort((a, b) => Number(a.match(/_(\d+)\./)![1]) - Number(b.match(/_(\d+)\./)![1]));

    // ffmpeg numbers outputs from 1. `fps=N` spaces them evenly, so frame k
    // sits at exactly `start + (k-1)/fps`. Deriving the time arithmetically is
    // both exact and independent of -frame_pts, which this build ignores.
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

      const index = Number(names[i].match(/_(\d+)\./)?.[1] ?? i + 1);
      const timestamp = start + (index - 1) / fps;

      // Anything landing outside the window belongs to a wider seek than the
      // capture asked for and would mislabel every subsequent frame.
      if (timestamp < start - 1e-6 || timestamp >= end - 1e-6) continue;

      frames.push({
        id: `frame-${index}-${timestamp.toFixed(3)}`,
        url: URL.createObjectURL(new Blob([data as Uint8Array], { type: `image/${ext}` })),
        timestamp,
      });

      onProgress({
        phase: 'reading',
        percentage: Math.min(99, 5 + ((i + 1) / Math.max(1, names.length)) * 70),
        currentFrame: i + 1,
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
