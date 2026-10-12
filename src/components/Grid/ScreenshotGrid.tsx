import React, { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiArrowLeft,
  FiCheck,
  FiDownload,
  FiTrash2,
  FiMaximize2,
  FiFilter,
} from 'react-icons/fi';
import JSZip from 'jszip';
import { Frame, ProcessingOptions, formatClock } from '../../types';
import { Lightbox } from './Lightbox';
import '../Gallery.css';

interface ScreenshotGridProps {
  frames: Frame[];
  duration: number;
  options: ProcessingOptions;
  /** Set when these frames were restored from a previous visit. */
  restored?: { fileName: string; frameCount: number } | null;
  onBack: () => void;
  onDiscardRestored?: () => void;
}

async function zipAndDownload(frames: Frame[], filename: string, ext: string): Promise<void> {
  const zip = new JSZip();
  // Sequential rather than Promise.all: hundreds of parallel fetches spike memory
  // at exactly the moment we are already near the cap.
  for (const frame of frames) {
    const response = await fetch(frame.url);
    zip.file(`frame-${formatClock(frame.timestamp).replace(/:/g, '-')}.${ext}`, await response.blob());
  }
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a beat to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const ScreenshotGrid: React.FC<ScreenshotGridProps> = ({
  frames,
  duration,
  options,
  restored,
  onBack,
  onDiscardRestored,
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [minGap, setMinGap] = useState(0);

  // Object URLs carry no format info, so the user's chosen format is the
  // source of truth for naming downloaded files.
  const ext = options.format;

  // "Filter" keeps every Nth frame, the quickest useful way to thin a dense set.
  const visible = useMemo(
    () => (minGap > 0 ? frames.filter((_, i) => i % (minGap + 1) === 0) : frames),
    [frames, minGap]
  );

  const toggleSelect = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      console.error('Download failed:', error);
      alert('Could not build the download. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = () => run(() => zipAndDownload(visible, 'wansnap-frames.zip', ext));
  const downloadSelected = () =>
    run(() => zipAndDownload(Array.from(selected).map((i) => frames[i]), 'wansnap-selected.zip', ext));

  // `visible` is a filtered view of `frames`, so selection has to be keyed by
  // the real index rather than the position of the filtered item. A Map keeps
  // that lookup O(1) instead of scanning the whole list per tile.
  const originalIndex = useMemo(() => {
    const map = new Map<string, number>();
    frames.forEach((frame, i) => map.set(frame.id, i));
    return map;
  }, [frames]);

  const indexOf = useCallback((frame: Frame) => originalIndex.get(frame.id) ?? -1, [originalIndex]);

  return (
    <div className="gallery">
      <header className="gallery__bar">
        <button className="icon-btn gallery__back" onClick={onBack} aria-label="Go back">
          <FiArrowLeft size={19} />
        </button>
        <div className="gallery__title">
          <h2>Your Shots</h2>
          <p className="gallery__meta">
            {formatClock(duration)} · {options.format.toUpperCase()} · {options.fps} fps
          </p>
        </div>
        <button
          className={`icon-btn gallery__filter ${filterOpen ? 'is-open' : ''}`}
          onClick={() => setFilterOpen((v) => !v)}
          aria-expanded={filterOpen}
          aria-label="Filter frames"
        >
          <FiFilter size={18} />
        </button>
      </header>

      <div className="gallery__summary">
        <div className="gallery__count">
          <strong>{visible.length}</strong>
          <span>Frame{visible.length === 1 ? '' : 's'}</span>
        </div>
        <p className="gallery__hint">Tap to select, tap the expand icon to view</p>
      </div>

      {restored && (
        <motion.div
          className="restore-banner"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span>
            Restored {restored.frameCount} frame{restored.frameCount === 1 ? '' : 's'} from your
            last session{restored.fileName ? ` (${restored.fileName})` : ''}.
          </span>
          {onDiscardRestored && (
            <button type="button" className="restore-banner__action" onClick={onDiscardRestored}>
              Start fresh
            </button>
          )}
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {filterOpen && (
          <motion.div
            className="filter-panel card"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="filter-panel__inner">
              <label className="field" htmlFor="thin">
                <span>Show every</span>
                <select
                  id="thin"
                  value={minGap}
                  onChange={(e) => setMinGap(Number(e.target.value))}
                  className="select"
                >
                  <option value={0}>frame</option>
                  <option value={1}>2nd frame</option>
                  <option value={2}>3rd frame</option>
                  <option value={4}>every 5th</option>
                </select>
              </label>
              <p className="filter-panel__hint">
                Thins the grid for quick picking. Downloads follow this filter.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        className="btn-brand gallery__download"
        onClick={downloadAll}
        disabled={busy || visible.length === 0}
      >
        <FiDownload size={17} />
        {busy ? 'Preparing…' : `Download ${visible.length} frame${visible.length === 1 ? '' : 's'}`}
      </button>

      {selected.size > 0 && (
        <button type="button" className="btn-ghost gallery__download" onClick={downloadSelected}>
          <FiDownload size={16} />
          Download {selected.size} selected
        </button>
      )}

      <ul className="frames">
        {visible.map((frame, i) => {
          const realIndex = indexOf(frame);
          const isSelected = selected.has(realIndex);
          return (
            <motion.li
              key={frame.id}
              className={`frame ${isSelected ? 'frame--selected' : ''}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, delay: Math.min(i * 0.02, 0.4), ease: [0.16, 1, 0.3, 1] }}
              onClick={() => toggleSelect(realIndex)}
            >
              <img
                src={frame.url}
                alt={`Frame at ${formatClock(frame.timestamp)}`}
                loading={i < 8 ? 'eager' : 'lazy'}
                decoding="async"
              />

              <button
                type="button"
                className="frame__expand"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(realIndex);
                }}
                aria-label={`Open frame at ${formatClock(frame.timestamp)}`}
              >
                <FiMaximize2 size={13} />
              </button>

              {isSelected && (
                <span className="frame__check" aria-hidden="true">
                  <FiCheck size={13} />
                </span>
              )}

              <span className="frame__stamp">{formatClock(frame.timestamp)}</span>
            </motion.li>
          );
        })}
      </ul>

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            className="selection-bar"
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="selection-bar__count">{selected.size}</span>
            <span className="selection-bar__label">
              Shot{selected.size === 1 ? '' : 's'} selected
            </span>
            <span className="selection-bar__actions">
              <button
                type="button"
                className="icon-btn selection-bar__action"
                onClick={clearSelection}
                aria-label="Clear selection"
              >
                <FiTrash2 size={17} />
              </button>
              <button
                type="button"
                className="icon-btn selection-bar__download"
                onClick={downloadSelected}
                disabled={busy}
                aria-label="Download selected"
              >
                <FiDownload size={17} />
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <Lightbox
        frames={frames}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
        onDownload={() => undefined}
      />
    </div>
  );
};
