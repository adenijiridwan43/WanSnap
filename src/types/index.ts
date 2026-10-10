// src/types/index.ts

/** A single captured frame. `timestamp` is seconds from the start of the video. */
export interface Frame {
  id: string;
  url: string;
  timestamp: number;
}

export interface Duration {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface TimeStamp {
  start: Duration;
  end?: Duration;
}

export interface ScreenshotRequest {
  timestamp: TimeStamp;
  file: File;
}

/** Seconds -> `Duration` parts. */
export function toDuration(totalSeconds: number): Duration {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  return {
    hours: Math.floor(safe / 3600),
    minutes: Math.floor((safe % 3600) / 60),
    seconds: Math.floor(safe % 60),
  };
}

/** Seconds -> `MM:SS` (or `HH:MM:SS` past an hour). Used for frame labels. */
export function formatClock(totalSeconds: number): string {
  const { hours, minutes, seconds } = toDuration(totalSeconds);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type OutputFormat = 'jpg' | 'png' | 'webp';

export interface ProcessingOptions {
  /** Frames per second for uniform capture. */
  fps: number;
  /** JPEG/PNG/WebP quality, 1-31 (lower is better) for lossy formats. */
  quality: number;
  /** Output image format. */
  format: OutputFormat;
  /** Hard cap on video duration in seconds. */
  maxDuration: number;
  /** Hard cap on how many frames we will retain, to bound memory. */
  maxFrames: number;
  /** Only capture within [trimStart, trimEnd] in seconds. */
  trimStart: number;
  trimEnd: number | null;
  /** Explicit capture points in seconds. When set, fps sampling is skipped. */
  customTimestamps: number[] | null;
  /** Drop near-identical consecutive frames. */
  dedupe: boolean;
  /** Similarity threshold 0-1; lower keeps more frames. */
  dedupeThreshold: number;
}

export const DEFAULT_OPTIONS: ProcessingOptions = {
  fps: 1,
  quality: 5,
  format: 'jpg',
  maxDuration: 240,
  maxFrames: 300,
  trimStart: 0,
  trimEnd: null,
  customTimestamps: null,
  dedupe: false,
  dedupeThreshold: 0.02,
};

/** Validation bounds, applied before they reach ffmpeg (a bad value is an opaque failure). */
export const LIMITS = {
  fps: { min: 0.1, max: 10 },
  quality: { min: 1, max: 31 },
  maxDuration: { min: 1, max: 3600 },
  maxFrames: { min: 1, max: 2000 },
} as const;

export interface VideoState {
  file: File | null;
  duration: number;
  processing: boolean;
  frames: Frame[];
  error: string | null;
}

export interface VideoValidationProps {
  file: File;
  maxDuration: number;
}

export interface VideoMetadata {
  duration: number;
  fileSize: number;
  format: string;
  dimensions: {
    width: number;
    height: number;
  };
}

export type ProcessingPhase = 'loading' | 'decoding' | 'reading' | 'done';

export interface ProcessingProgress {
  phase: ProcessingPhase;
  percentage: number;
  currentFrame: number;
  totalFrames: number;
  timeRemaining?: number;
}