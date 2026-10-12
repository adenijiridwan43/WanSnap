// src/utils/validators.ts
import { VideoMetadata, VideoValidationProps } from '../types';
import { ffmpegService } from './ffmpeg';

const METADATA_TIMEOUT_MS = 5000;

/**
 * Asks ffmpeg for the real duration.
 *
 * The HTML5 <video> probe reports 0 for a number of perfectly valid files
 * (MediaRecorder output, MP4s without a leading moov atom, some MKVs). Rather
 * than reject those outright, fall back to ffprobe so they still work.
 */
export async function probeDurationWithFFmpeg(file: File): Promise<number | null> {
  try {
    await ffmpegService.load();
    const seconds = await ffmpegService.probeDuration(file);
    if (seconds && seconds > 0) return seconds;

    // A null here means ffmpeg ran but printed no Duration banner, which
    // happens when the container is one it cannot demux. Say so rather than
    // leaving the user with a misleading "try a different file".
    console.warn('[validators] ffmpeg could not read a duration from', file.name, file.type);
    return null;
  } catch (error) {
    console.warn('[validators] ffmpeg duration probe failed:', error);
    return null;
  }
}

/** Reads duration/size off a video file without decoding it. */
export function probeVideo(file: File): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      fn();
    };

    const timer = window.setTimeout(
      () => finish(() => reject(new Error('Timed out while reading the video. The file may be corrupt or in an unsupported format.'))),
      METADATA_TIMEOUT_MS
    );

    video.preload = 'metadata';
    video.muted = true;

    video.onloadedmetadata = () => {
      finish(() =>
        resolve({
          // Some webm/mkv files report Infinity until seeked; treat as unusable rather
          // than letting an infinite duration flow into frame-count math.
          duration: Number.isFinite(video.duration) ? video.duration : 0,
          fileSize: file.size,
          format: file.type || 'unknown',
          dimensions: {
            width: video.videoWidth || 0,
            height: video.videoHeight || 0,
          },
        })
      );
    };

    // Previously missing: a non-decodable file left this promise pending forever,
    // because `onloadedmetadata` never fires for it and nothing rejected.
    video.onerror = () =>
      finish(() => reject(new Error('This file could not be read as a video.')));

    video.src = url;
  });
}

export const validateVideo = async ({
  file,
  maxDuration,
}: VideoValidationProps): Promise<{ isValid: boolean; metadata?: VideoMetadata; error?: string }> => {
  // Check the MIME type up front. Previously this ran *after* onloadedmetadata,
  // which a non-video never reaches, so bad files hung instead of erroring.
  if (!file.type.startsWith('video/')) {
    return { isValid: false, error: 'That file is not a video. Please choose a video file.' };
  }

  let metadata: VideoMetadata;
  try {
    metadata = await probeVideo(file);
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'This file could not be read as a video.',
    };
  }

  if (metadata.duration <= 0) {
    // The browser could not read the length. Try ffmpeg before giving up, since
    // rejecting here would lock out files it can still process fine.
    const probed = await probeDurationWithFFmpeg(file);
    if (probed === null) {
      return {
        isValid: false,
        error:
          'This video could not be read. It may use a codec this browser does not support, ' +
          'or the file may be incomplete. Try exporting it as MP4 (H.264).',
      };
    }
    metadata = { ...metadata, duration: probed };
  }

  if (metadata.duration > maxDuration) {
    const minutes = Math.round(maxDuration / 60);
    return { isValid: false, error: `Video is longer than ${minutes} minutes. Trim it first or raise the limit in Settings.` };
  }

  if (metadata.fileSize === 0) {
    return { isValid: false, error: 'That file is empty.' };
  }

  return { isValid: true, metadata };
};

/** Rough guard against the memory blow-up from writing every frame into MEMFS. */
export const estimateFrames = (duration: number, fps: number, trimEnd: number | null): number => {
  const span = Math.max(0, (trimEnd ?? duration) - 0);
  return Math.floor(span * fps) + 1;
};