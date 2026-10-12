import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiChevronLeft, FiChevronRight, FiDownload } from 'react-icons/fi';
import { Frame, formatClock } from '../../types';
import '../Lightbox.css';

interface LightboxProps {
  frames: Frame[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onDownload: (frame: Frame) => void;
}

/** Refetches the blob behind an object URL so we can save it under a real name. */
async function downloadFrame(frame: Frame): Promise<void> {
  const response = await fetch(frame.url);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `wansnap-${formatClock(frame.timestamp).replace(/:/g, 'm')}s.${frame.url.includes('png') ? 'png' : 'jpg'}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
}

export const Lightbox: React.FC<LightboxProps> = ({
  frames,
  index,
  onClose,
  onIndexChange,
  onDownload
}) => {
  const [showInfo, setShowInfo] = useState(true);
  const open = index !== null;

  const go = useCallback(
    (delta: number) => {
      if (index === null || frames.length === 0) return;
      const next = (index + delta + frames.length) % frames.length;
      onIndexChange(next);
    },
    [index, frames.length, onIndexChange]
  );

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowRight':
          e.preventDefault();
          go(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          go(-1);
          break;
        case 'i':
        case 'I':
          setShowInfo((v) => !v);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    // Stop the page behind the overlay from scrolling on arrow keys.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, go, onClose]);

  const frame = index !== null ? frames[index] : null;

  return (
    <AnimatePresence>
      {open && frame && (
        <motion.div
          className="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Frame ${formatClock(frame.timestamp)}`}
        >
          <motion.img
            key={frame.id}
            src={frame.url}
            alt={`Frame at ${formatClock(frame.timestamp)}`}
            className="lightbox-image"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
          />

          <button className="lightbox__control lightbox__close" onClick={onClose} aria-label="Close">
            <FiX size={22} />
          </button>

          {frames.length > 1 && (
            <>
              <button
                className="lightbox__control lightbox__nav lightbox__nav--prev"
                onClick={(e) => {
                  e.stopPropagation();
                  go(-1);
                }}
                aria-label="Previous frame"
              >
                <FiChevronLeft size={26} />
              </button>
              <button
                className="lightbox__control lightbox__nav lightbox__nav--next"
                onClick={(e) => {
                  e.stopPropagation();
                  go(1);
                }}
                aria-label="Next frame"
              >
                <FiChevronRight size={26} />
              </button>
            </>
          )}

          {showInfo && (
            <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
              <span className="lightbox__meta">
                <span className="lightbox__time">{formatClock(frame.timestamp)}</span>
                <span className="lightbox__index">
                  Frame {(index ?? 0) + 1} of {frames.length}
                </span>
              </span>
              <button
                type="button"
                className="lightbox__download"
                onClick={() => {
                  void downloadFrame(frame);
                  onDownload(frame);
                }}
              >
                <FiDownload size={15} /> Download
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};