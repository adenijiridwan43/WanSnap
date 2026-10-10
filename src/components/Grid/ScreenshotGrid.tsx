import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FiArrowLeft, FiCheck, FiDownload, FiTrash2, FiMaximize2 } from 'react-icons/fi';
import JSZip from 'jszip';
import { Frame, ProcessingOptions, formatClock } from '../../types';
import { Lightbox } from './Lightbox';

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

  return (
    <div className="gallery-wrapper">
      <header className="gallery-header">
        <button className="gallery-back" onClick={onBack} aria-label="Go back">
          <FiArrowLeft size={20} />
        </button>
        <div className="gallery-header-center">
          <h2>Your Shots</h2>
          <span className="gallery-badge">VIDEO PROCESSED</span>
        </div>
        <div className="gallery-header-right">
          <div className="gallery-check-icon">
            <FiCheck size={16} />
          </div>
        </div>
      </header>

      <div className="gallery-info">
        <div>
          <h3 className="frame-count">{visible.length} Frames</h3>
          <p className="frame-subtitle">
            {formatClock(duration)} · {options.format.toUpperCase()} · {options.fps} fps
          </p>
        </div>
        <button
          className={`filter-btn ${filterOpen ? 'active' : ''}`}
          onClick={() => setFilterOpen((v) => !v)}
          aria-expanded={filterOpen}
        >
          <span>Filter</span>
        </button>
      </div>

      {restored && (
        <motion.div
          className="restore-banner"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span>
            Restored your last session
            {restored.fileName ? ` (${restored.fileName})` : ''} —{' '}
            {restored.frameCount} frame{restored.frameCount === 1 ? '' : 's'} kept on this device.
          </span>
          {onDiscardRestored && (
            <button onClick={onDiscardRestored}>Start fresh</button>
          )}
        </motion.div>
      )}

      {filterOpen && (
        <div className="filter-panel">
          <label htmlFor="thin">
            Show every
            <select id="thin" value={minGap} onChange={(e) => setMinGap(Number(e.target.value))}>
              <option value={0}>frame</option>
              <option value={1}>2nd frame</option>
              <option value={2}>3rd frame</option>
              <option value={4}>every 5th</option>
            </select>
          </label>
          <p className="hint">Thins the grid for quick picking. Downloads follow this filter.</p>
        </div>
      )}

      <motion.button
        className="download-all-btn"
        onClick={downloadAll}
        whileTap={{ scale: 0.97 }}
        disabled={busy || visible.length === 0}
      >
        <FiDownload size={18} />
        <span>{busy ? 'Preparing...' : 'Download All Shots'}</span>
      </motion.button>

      <div className="screenshot-grid">
        {visible.map((frame, index) => (
          <motion.div
            key={frame.id}
            className={`grid-item ${selected.has(frames.indexOf(frame)) ? 'selected' : ''}`}
            onClick={() => toggleSelect(frames.indexOf(frame))}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.6) }}
          >
            <img
              src={frame.url}
              alt={`Frame at ${formatClock(frame.timestamp)}`}
              onDoubleClick={() => setLightboxIndex(frames.indexOf(frame))}
              loading="lazy"
            />
            <button
              className="expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(frames.indexOf(frame));
              }}
              aria-label={`Open frame at ${formatClock(frame.timestamp)}`}
            >
              <FiMaximize2 size={14} />
            </button>
            {selected.has(frames.indexOf(frame)) && (
              <div className="selected-check">
                <FiCheck size={14} />
              </div>
            )}
            <span className="timestamp">{formatClock(frame.timestamp)}</span>
          </motion.div>
        ))}
      </div>

      {selected.size > 0 && (
        <motion.div className="selection-bar" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="selection-info">
            <span className="selection-count">{selected.size}</span>
            <span>Shot{selected.size !== 1 ? 's' : ''} Selected</span>
          </div>
          <div className="selection-actions">
            <button className="selection-action-btn" onClick={clearSelection} aria-label="Clear selection">
              <FiTrash2 size={18} />
            </button>
            <button className="selection-action-btn download" onClick={downloadSelected} aria-label="Download selected">
              <FiDownload size={18} />
            </button>
          </div>
        </motion.div>
      )}

      <Lightbox
        frames={frames}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
        onDownload={() => undefined}
      />

      <style>{`
        .gallery-wrapper { padding: 16px; max-width: 800px; margin: 0 auto; width: 100%; padding-bottom: 140px; }
        .restore-banner {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          background: #FFF0E8; border: 1px solid #FDDCC8; border-radius: 14px;
          padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: #8A5A3C;
          flex-wrap: wrap;
        }
        .restore-banner button {
          border: 1px solid #E8734A; background: #fff; color: #E8734A;
          border-radius: 20px; padding: 6px 14px; font-size: 12px;
          font-weight: 600; cursor: pointer; flex-shrink: 0;
        }
        .restore-banner button:hover { background: #E8734A; color: #fff; }
        .gallery-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 24px; padding-top: 8px;
        }
        .gallery-back {
          width: 40px; height: 40px; border-radius: 50%; background: #F5F0EC; border: none;
          display: flex; align-items: center; justify-content: center; color: #2D2D3A;
          cursor: pointer; transition: all 0.2s; flex-shrink: 0;
        }
        .gallery-back:hover { background: #EDE6E0; }
        .gallery-header-center { text-align: center; }
        .gallery-header-center h2 { font-size: 18px; font-weight: 700; color: #2D2D3A; margin: 0; }
        .gallery-badge { font-size: 10px; font-weight: 700; color: #E8734A; letter-spacing: 1.5px; text-transform: uppercase; }
        .gallery-header-right { display: flex; align-items: center; }
        .gallery-check-icon {
          width: 36px; height: 36px; border-radius: 50%;
          background: linear-gradient(135deg, #E8734A, #F09468);
          display: flex; align-items: center; justify-content: center; color: white;
        }
        .gallery-info { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .frame-count { font-size: 28px; font-weight: 800; color: #2D2D3A; margin: 0; }
        .frame-subtitle { font-size: 14px; color: #8A8A9A; margin: 2px 0 0; }
        .filter-btn {
          display: flex; align-items: center; gap: 6px; padding: 8px 16px;
          background: #F5F0EC; border: 1px solid #F0E6DE; border-radius: 10px;
          font-size: 13px; font-weight: 600; color: #2D2D3A; cursor: pointer; transition: all 0.2s;
        }
        .filter-btn:hover, .filter-btn.active { background: #EDE6E0; color: #E8734A; }
        .filter-panel {
          background: #FFF; border: 1px solid #F0E6DE; border-radius: 14px;
          padding: 14px 16px; margin-bottom: 16px;
        }
        .filter-panel label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #2D2D3A; font-weight: 600; }
        .filter-panel select {
          border: 1px solid #F0E6DE; border-radius: 8px; padding: 4px 8px;
          font-size: 13px; background: #FFF; color: #2D2D3A;
        }
        .filter-panel .hint { font-size: 12px; color: #8A8A9A; margin: 6px 0 0; }
        .download-all-btn {
          width: 100%; padding: 14px 20px;
          background: linear-gradient(135deg, #E8734A, #F09468);
          color: white; border: none; border-radius: 16px; font-size: 15px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          cursor: pointer; margin-bottom: 20px; box-shadow: 0 4px 16px rgba(232, 115, 74, 0.3);
          transition: all 0.2s;
        }
        .download-all-btn:hover:not(:disabled) { box-shadow: 0 6px 24px rgba(232, 115, 74, 0.4); transform: translateY(-1px); }
        .download-all-btn:disabled { opacity: 0.6; cursor: wait; transform: none; }
        .screenshot-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .grid-item {
          position: relative; border-radius: 14px; overflow: hidden; cursor: pointer;
          background: #F5F0EC; aspect-ratio: 1; transition: all 0.2s; border: 3px solid transparent;
        }
        .grid-item:hover { transform: scale(1.02); }
        .grid-item.selected { border-color: #E8734A; }
        .grid-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .expand-btn {
          position: absolute; top: 8px; left: 8px; width: 28px; height: 28px;
          border-radius: 8px; border: none; background: rgba(0,0,0,0.5); color: #fff;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          opacity: 0; transition: opacity 0.2s;
        }
        .grid-item:hover .expand-btn { opacity: 1; }
        .selected-check {
          position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border-radius: 50%;
          background: #E8734A; color: white; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }
        .timestamp {
          position: absolute; bottom: 8px; left: 10px; font-size: 12px; font-weight: 600;
          color: #E8734A; background: rgba(255,255,255,0.85); padding: 2px 8px;
          border-radius: 6px; backdrop-filter: blur(4px);
        }
        .selection-bar {
          position: fixed; bottom: 75px; left: 16px; right: 16px; max-width: 768px; margin: 0 auto;
          background: linear-gradient(135deg, #F9A882, #E8734A); border-radius: 20px; padding: 14px 20px;
          display: flex; justify-content: space-between; align-items: center; color: white;
          box-shadow: 0 8px 30px rgba(232,115,74,0.4); z-index: 90;
        }
        .selection-info { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
        .selection-count {
          width: 28px; height: 28px; background: rgba(255,255,255,0.3); border-radius: 50%;
          display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700;
        }
        .selection-actions { display: flex; gap: 8px; }
        .selection-action-btn {
          width: 40px; height: 40px; border-radius: 12px; border: none;
          background: rgba(255,255,255,0.2); color: white; display: flex; align-items: center;
          justify-content: center; cursor: pointer; transition: all 0.2s;
        }
        .selection-action-btn:hover { background: rgba(255,255,255,0.35); }
        .selection-action-btn.download { background: white; color: #E8734A; }

        .lightbox {
          position: fixed; inset: 0; z-index: 300; background: rgba(0,0,0,0.92);
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .lightbox-image {
          max-width: 100%; max-height: 100%; object-fit: contain;
          border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .lightbox-close, .lightbox-nav {
          position: absolute; background: rgba(255,255,255,0.12); color: #fff;
          border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.2s;
        }
        .lightbox-close:hover, .lightbox-nav:hover { background: rgba(255,255,255,0.28); }
        .lightbox-close { top: 16px; right: 16px; width: 42px; height: 42px; border-radius: 50%; }
        .lightbox-nav { top: 50%; transform: translateY(-50%); width: 48px; height: 48px; border-radius: 50%; }
        .lightbox-nav.left { left: 16px; }
        .lightbox-nav.right { right: 16px; }
        .lightbox-bar {
          position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
          display: flex; align-items: center; gap: 20px; padding: 12px 20px;
          background: rgba(255,255,255,0.12); backdrop-filter: blur(12px);
          border-radius: 40px; color: #fff;
        }
        .lightbox-meta { display: flex; flex-direction: column; line-height: 1.3; }
        .lightbox-meta strong { font-size: 15px; }
        .lightbox-meta span { font-size: 12px; opacity: 0.75; }
        .lightbox-download {
          display: flex; align-items: center; gap: 6px; padding: 9px 16px;
          background: #E8734A; color: #fff; border: none; border-radius: 30px;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .lightbox-download:hover { background: #D9643C; }

        @media (max-width: 599px) {
          .lightbox-nav { width: 40px; height: 40px; }
          .lightbox-nav.left { left: 8px; }
          .lightbox-nav.right { right: 8px; }
        }
        @media (min-width: 600px) { .screenshot-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (min-width: 768px) {
          .gallery-wrapper { padding: 32px; }
          .screenshot-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; }
          .frame-count { font-size: 34px; }
        }
        @media (min-width: 1024px) {
          .screenshot-grid { grid-template-columns: repeat(4, 1fr); gap: 18px; }
          .selection-bar { left: 50%; right: auto; transform: translateX(-50%); width: 500px; }
        }
      `}</style>
    </div>
  );
};