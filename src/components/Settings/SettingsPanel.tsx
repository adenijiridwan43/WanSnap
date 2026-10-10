import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiCheck, FiRotateCcw } from 'react-icons/fi';
import {
  DEFAULT_OPTIONS,
  LIMITS,
  ProcessingOptions,
  OutputFormat,
  formatClock
} from '../../types';
import './settings.css';

interface SettingsPanelProps {
  open: boolean;
  options: ProcessingOptions;
  duration: number;
  onClose: () => void;
  onApply: (options: ProcessingOptions) => void;
}

const FORMATS: OutputFormat[] = ['jpg', 'png', 'webp'];

const MAX_CUSTOM_STAMPS = 100;

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  open,
  options,
  duration,
  onClose,
  onApply
}) => {
  const [draft, setDraft] = useState<ProcessingOptions>(options);
  const [stampText, setStampText] = useState('');
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(options);
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const patch = (partial: Partial<ProcessingOptions>) =>
    setDraft((prev) => ({ ...prev, ...partial }));

  const reset = () => {
    setDraft({ ...DEFAULT_OPTIONS, trimEnd: null, trimStart: 0, customTimestamps: null });
    setStampText('');
  };

  const addStamps = () => {
    // Accept "0:05, 1:20, 90" - bare seconds, m:ss, or h:mm:ss.
    const parsed = stampText
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => {
        if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
        const parts = token.split(':').map(Number);
        if (parts.some((n) => !Number.isFinite(n))) return NaN;
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return NaN;
      })
      .filter((n) => Number.isFinite(n) && n >= 0 && (duration === 0 || n <= duration));

    if (parsed.length === 0) return;

    const merged = Array.from(new Set([...(draft.customTimestamps ?? []), ...parsed]))
      .sort((a, b) => a - b)
      .slice(0, MAX_CUSTOM_STAMPS);

    patch({ customTimestamps: merged });
    setStampText('');
  };

  const removeStamp = (stamp: number) =>
    patch({ customTimestamps: (draft.customTimestamps ?? []).filter((s) => s !== stamp) });

  const effectiveDuration = draft.trimEnd ?? duration;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Capture settings"
        >
          <motion.div
            className="settings-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-header">
              <h2>Capture Settings</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close settings">
                <FiX size={20} />
              </button>
            </header>

            <div className="settings-body">
              <section className="field">
                <label htmlFor="fps">Frames per second</label>
                <input
                  id="fps"
                  ref={firstFieldRef}
                  type="number"
                  min={LIMITS.fps.min}
                  max={LIMITS.fps.max}
                  step="0.5"
                  value={draft.fps}
                  onChange={(e) => patch({ fps: Number(e.target.value) })}
                />
                <p className="hint">
                  Higher fps means more frames and slower processing.
                  {duration > 0 ? (
                    <>
                      {' '}This video yields roughly{' '}
                      <strong>{Math.max(0, Math.round((effectiveDuration - draft.trimStart) * draft.fps))}</strong>{' '}
                      frames at {draft.fps} fps.
                    </>
                  ) : (
                    ' Upload a video to see the estimated frame count.'
                  )}
                </p>
              </section>

              <section className="field">
                <label htmlFor="quality">
                  Quality
                  <span className="value-tag">
                    {draft.quality} {draft.format === 'png' ? '(lossless)' : draft.quality <= 4 ? '(best)' : draft.quality >= 20 ? '(smallest)' : ''}
                  </span>
                </label>
                <input
                  id="quality"
                  type="range"
                  min={LIMITS.quality.min}
                  max={LIMITS.quality.max}
                  value={draft.quality}
                  onChange={(e) => patch({ quality: Number(e.target.value) })}
                  disabled={draft.format === 'png'}
                />
                <p className="hint">
                  1 is highest quality and largest file size; 31 is the most compressed.
                  {draft.format === 'png' && ' PNG is lossless, so this does not apply.'}
                </p>
              </section>

              <section className="field">
                <label>Format</label>
                <div className="segmented">
                  {FORMATS.map((format) => (
                    <button
                      key={format}
                      className={draft.format === format ? 'active' : ''}
                      onClick={() => patch({ format })}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </section>

              <section className="field">
                <label htmlFor="maxDuration">Maximum video length</label>
                <div className="inline-row">
                  <input
                    id="maxDuration"
                    type="number"
                    min={LIMITS.maxDuration.min}
                    max={LIMITS.maxDuration.max}
                    step="10"
                    value={draft.maxDuration}
                    onChange={(e) => patch({ maxDuration: Number(e.target.value) })}
                  />
                  <span className="unit">sec</span>
                </div>
                <p className="hint">Videos longer than this are rejected before processing.</p>
              </section>

              <section className="field">
                <label htmlFor="maxFrames">Frame cap</label>
                <div className="inline-row">
                  <input
                    id="maxFrames"
                    type="number"
                    min={LIMITS.maxFrames.min}
                    max={LIMITS.maxFrames.max}
                    step="10"
                    value={draft.maxFrames}
                    onChange={(e) => patch({ maxFrames: Number(e.target.value) })}
                  />
                  <span className="unit">frames</span>
                </div>
                <p className="hint">
                  Protects memory. Each frame is held in the browser while processing.
                </p>
              </section>

              {duration > 0 && (
                <section className="field">
                  <label>Trim range</label>
                  <div className="inline-row">
                    <input
                      type="number"
                      min={0}
                      max={duration}
                      step="0.1"
                      value={Number(draft.trimStart.toFixed(2))}
                      onChange={(e) =>
                        patch({ trimStart: Math.min(Number(e.target.value), duration) })
                      }
                      aria-label="Trim start in seconds"
                    />
                    <span className="unit">to</span>
                    <input
                      type="number"
                      min={0}
                      max={duration}
                      step="0.1"
                      value={draft.trimEnd === null ? Number(duration.toFixed(2)) : Number(draft.trimEnd.toFixed(2))}
                      onChange={(e) => patch({ trimEnd: Math.min(Number(e.target.value), duration) })}
                      aria-label="Trim end in seconds"
                    />
                    <span className="unit">sec</span>
                  </div>
                  <p className="hint">
                    Capturing {formatClock(Math.max(0, effectiveDuration - draft.trimStart))} of{' '}
                    {formatClock(duration)}.
                  </p>
                </section>
              )}

              <section className="field">
                <label htmlFor="stamps">Custom timestamps</label>
                <p className="hint" style={{ marginTop: 0 }}>
                  Add specific moments to capture instead of sampling evenly. Enter seconds or
                  m:ss, separated by commas. Up to {MAX_CUSTOM_STAMPS}.
                </p>
                <div className="inline-row">
                  <input
                    id="stamps"
                    type="text"
                    placeholder="0:05, 1:20, 2:45"
                    value={stampText}
                    onChange={(e) => setStampText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addStamps();
                      }
                    }}
                  />
                  <button className="small-btn" onClick={addStamps}>
                    Add
                  </button>
                </div>
                {(draft.customTimestamps ?? []).length > 0 && (
                  <div className="stamp-list">
                    {(draft.customTimestamps ?? []).map((stamp) => (
                      <button key={stamp} className="chip" onClick={() => removeStamp(stamp)}>
                        {formatClock(stamp)} <FiX size={12} />
                      </button>
                    ))}
                    <button
                      className="chip clear"
                      onClick={() => patch({ customTimestamps: null })}
                    >
                      Clear all
                    </button>
                  </div>
                )}
                {draft.customTimestamps && (
                  <p className="hint warn">
                    Custom timestamps are active, so even fps sampling is skipped.
                  </p>
                )}
              </section>

              <section className="field">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={draft.dedupe}
                    onChange={(e) => patch({ dedupe: e.target.checked })}
                  />
                  <span>
                    <strong>Remove similar frames</strong>
                    <em>Keeps only visually distinct shots. Static scenes produce far fewer frames.</em>
                  </span>
                </label>
                {draft.dedupe && (
                  <input
                    type="range"
                    min={0}
                    max={0.15}
                    step={0.005}
                    value={draft.dedupeThreshold}
                    onChange={(e) => patch({ dedupeThreshold: Number(e.target.value) })}
                    aria-label="Similarity threshold"
                  />
                )}
              </section>
            </div>

            <footer className="settings-footer">
              <button className="ghost-btn" onClick={reset}>
                <FiRotateCcw size={16} /> Reset
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  const sanitised = {
                    ...draft,
                    trimEnd:
                      draft.trimEnd !== null && draft.trimEnd <= draft.trimStart
                        ? null
                        : draft.trimEnd,
                  };
                  onApply(sanitised);
                  onClose();
                }}
              >
                <FiCheck size={16} /> Apply
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};