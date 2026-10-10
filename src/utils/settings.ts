// src/utils/settings.ts
import { DEFAULT_OPTIONS, LIMITS, ProcessingOptions } from '../types';

const KEY = 'wansnap.settings.v1';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
};

export function sanitizeOptions(raw: Partial<ProcessingOptions> | null | undefined): ProcessingOptions {
  if (!raw) return { ...DEFAULT_OPTIONS };

  const customTimestamps = Array.isArray(raw.customTimestamps)
    ? raw.customTimestamps.filter((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0).sort((a, b) => a - b)
    : null;

  return {
    fps: num(raw.fps, DEFAULT_OPTIONS.fps, LIMITS.fps.min, LIMITS.fps.max),
    quality: num(raw.quality, DEFAULT_OPTIONS.quality, LIMITS.quality.min, LIMITS.quality.max),
    format: raw.format === 'png' || raw.format === 'webp' || raw.format === 'jpg' ? raw.format : DEFAULT_OPTIONS.format,
    maxDuration: num(raw.maxDuration, DEFAULT_OPTIONS.maxDuration, LIMITS.maxDuration.min, LIMITS.maxDuration.max),
    maxFrames: num(raw.maxFrames, DEFAULT_OPTIONS.maxFrames, LIMITS.maxFrames.min, LIMITS.maxFrames.max),
    trimStart: Math.max(0, num(raw.trimStart, 0, 0, 86400)),
    trimEnd: raw.trimEnd === null || raw.trimEnd === undefined ? null : Math.max(0, num(raw.trimEnd, 0, 0, 86400)),
    customTimestamps: customTimestamps && customTimestamps.length > 0 ? customTimestamps : null,
    dedupe: Boolean(raw.dedupe),
    dedupeThreshold: clamp(num(raw.dedupeThreshold, DEFAULT_OPTIONS.dedupeThreshold, 0, 1), 0, 1),
  };
}

export function loadOptions(): ProcessingOptions {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return { ...DEFAULT_OPTIONS };
    return sanitizeOptions(JSON.parse(stored) as Partial<ProcessingOptions>);
  } catch {
    // Corrupt or unavailable storage should never block the app from starting.
    return { ...DEFAULT_OPTIONS };
  }
}

export function saveOptions(options: ProcessingOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // Storage full or blocked (private mode) - settings simply will not persist.
  }
}