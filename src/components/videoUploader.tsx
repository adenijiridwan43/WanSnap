import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiPlus, FiSettings, FiX } from 'react-icons/fi';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { ProcessingOptions, ProcessingProgress, VideoState } from '../types';
import { validateVideo } from '../utils/validators';
import { CancelledError, ffmpegService } from '../utils/ffmpeg';
import { dedupeFrames } from '../utils/dedupe';
import { loadOptions, saveOptions } from '../utils/settings';
import { sessionStore } from '../utils/session';
import { ScreenshotGrid } from './Grid/ScreenshotGrid';
import { SettingsPanel } from './Settings/SettingsPanel';
import './uploader.css';

const initialState: VideoState = {
  file: null,
  duration: 0,
  processing: false,
  frames: [],
  error: null,
};

export const VideoUploader: React.FC = () => {
  const [state, setState] = useState<VideoState>(initialState);
  const [options, setOptions] = useState<ProcessingOptions>(() => loadOptions());
  const [progress, setProgress] = useState<ProcessingProgress>({
    phase: 'loading',
    percentage: 0,
    currentFrame: 0,
    totalFrames: 0,
  });
  const [dragOver, setDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restored, setRestored] = useState<{ fileName: string; frameCount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const framesRef = useRef<string[]>([]);

  // Object URLs are not garbage collected on their own; without this a few
  // captures exhaust the tab's memory.
  const releaseFrames = useCallback(() => {
    framesRef.current.forEach((url) => URL.revokeObjectURL(url));
    framesRef.current = [];
  }, []);

  // Offer the previous capture back on load rather than silently discarding it.
  useEffect(() => {
    let cancelled = false;
    sessionStore
      .loadCurrent()
      .then((result) => {
        if (!result || cancelled) return;
        releaseFrames();
        framesRef.current = result.frames.map((f) => f.url);
        setState({
          file: null,
          duration: result.session.duration,
          processing: false,
          frames: result.frames,
          error: null,
        });
        setRestored({ fileName: result.session.fileName, frameCount: result.frames.length });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [releaseFrames]);

  const dismissRestore = useCallback(async () => {
    setRestored(null);
    releaseFrames();
    setState(initialState);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await sessionStore.clear();
  }, [releaseFrames]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    await processFile(file);
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    await processFile(file);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const processFile = async (file: File | undefined) => {
    if (!file) {
      setState((prev) => ({ ...prev, error: 'No file selected.' }));
      return;
    }

    releaseFrames();
    setState({ ...initialState, processing: true });
    setProgress({ phase: 'loading', percentage: 0, currentFrame: 0, totalFrames: 0 });

    try {
      const validation = await validateVideo({ file, maxDuration: options.maxDuration });
      if (!validation.isValid || !validation.metadata) {
        throw new Error(validation.error ?? 'That file could not be used.');
      }

      const { duration } = validation.metadata;

      // Bound memory before doing any work.
      const span = (options.trimEnd ?? duration) - options.trimStart;
      const estimated = options.customTimestamps?.length ?? Math.floor(span * options.fps) + 1;
      if (estimated > options.maxFrames) {
        throw new Error(
          `This would capture about ${estimated} frames, over your cap of ${options.maxFrames}. ` +
            `Lower the frame rate, shorten the trim range, or raise the cap in Settings.`
        );
      }

      setState((prev) => ({ ...prev, file, duration }));

      let frames = await ffmpegService.processVideo(file, duration, options, setProgress);

      if (options.dedupe && frames.length > 1) {
        setProgress((p) => ({ ...p, phase: 'reading', percentage: Math.max(p.percentage, 90) }));
        frames = await dedupeFrames(frames, options.dedupeThreshold);
      }

      releaseFrames();
      framesRef.current = frames.map((f) => f.url);

      if (frames.length === 0) {
        throw new Error('No frames could be extracted from that video.');
      }

      setState({ file, duration, processing: false, frames, error: null });
      setRestored(null);

      // Persist so a reload does not cost the user a re-run. Failures are
      // non-fatal: the frames are already in memory.
      void sessionStore.save(frames, { fileName: file.name, duration, options });
    } catch (error) {
      if (error instanceof CancelledError) {
        releaseFrames();
        setState(initialState);
        setProgress({ phase: 'loading', percentage: 0, currentFrame: 0, totalFrames: 0 });
        return;
      }

      console.error('Video processing error:', error);
      if (fileInputRef.current) fileInputRef.current.value = '';

      releaseFrames();
      setState({
        file: null,
        duration: 0,
        processing: false,
        frames: [],
        error: error instanceof Error ? error.message : 'Something went wrong processing that video.',
      });
    }
  };

  const handleCancel = () => ffmpegService.cancel();

  const resetToUpload = () => {
    releaseFrames();
    setState(initialState);
    setRestored(null);
    setProgress({ phase: 'loading', percentage: 0, currentFrame: 0, totalFrames: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleApplySettings = (next: ProcessingOptions) => {
    setOptions(next);
    saveOptions(next);
  };

  if (state.frames.length > 0) {
    return (
      <ScreenshotGrid
        frames={state.frames}
        duration={state.duration}
        options={options}
        restored={restored}
        onBack={resetToUpload}
        onDiscardRestored={dismissRestore}
      />
    );
  }

  const phaseLabel: Record<ProcessingProgress['phase'], string> = {
    loading: 'Loading video tools…',
    decoding: 'Extracting frames…',
    reading: 'Finishing up…',
    done: 'Done',
  };

  return (
    <div className="page page--upload">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
              <line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand__text">
            <strong>WanSnap</strong>
            <em>Studio</em>
          </span>
        </div>

        <button
          className="icon-btn"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          disabled={state.processing}
        >
          <FiSettings size={19} />
        </button>
      </header>

      <motion.section
        className="hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="hero__title">
          Ready to create
          <br />
          <span>amazing snaps?</span>
        </h1>
        <p className="hero__sub">Turn your videos into perfect stills.</p>
      </motion.section>

      <motion.section
        className={`dropzone ${dragOver ? 'dropzone--active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        // Kept short: a long fade leaves the upload plate looking broken to
        // anyone who loads the page and glances away immediately.
        transition={{ duration: 0.3, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        role="region"
        aria-label="Video upload area"
      >
        <span className="dropzone__badge">
          <HiOutlineSparkles size={13} />
          Smart AI
        </span>

        {/* The whole plate is a click target as well as the explicit button, so
            there is no dead area on touch devices. */}
        <button
          type="button"
          className="dropzone__target"
          onClick={() => fileInputRef.current?.click()}
          disabled={state.processing}
          aria-label="Choose a video to extract frames from"
        >
          <span className="dropzone__icon">
            <FiPlus size={26} />
          </span>
          <span className="dropzone__heading">Upload Video</span>
          <span className="dropzone__hint">Browse your gallery or drop a file to begin</span>
        </button>

        <button
          type="button"
          className="btn-brand dropzone__cta"
          onClick={() => fileInputRef.current?.click()}
          disabled={state.processing}
        >
          Choose File
        </button>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="video/*"
          className="sr-only"
          tabIndex={-1}
        />
      </motion.section>

      <AnimatePresence>
        {state.error && (
          <motion.p
            className="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            role="alert"
          >
            {state.error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.processing && (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="progress-card"
              initial={{ scale: 0.94, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 12 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label={phaseLabel[progress.phase]}
            >
              {/* Progress is shown as a determinate ring once a total is known,
                  which reads as faster than a bar the same speed. */}
              <div className="progress-card__ring" aria-hidden="true">
                <svg viewBox="0 0 44 44">
                  <circle className="progress-card__track" cx="22" cy="22" r="19" />
                  <circle
                    className="progress-card__fill"
                    cx="22"
                    cy="22"
                    r="19"
                    style={{
                      strokeDashoffset: `${2 * Math.PI * 19 * (1 - Math.min(Math.max(progress.percentage, 0), 100) / 100)}`,
                    }}
                  />
                </svg>
                <span>{Math.round(Math.min(progress.percentage, 100))}%</span>
              </div>

              <h2 className="progress-card__title">{phaseLabel[progress.phase]}</h2>
              <p className="progress-card__meta">
                {progress.totalFrames > 0 ? (
                  <>Frame {Math.min(progress.currentFrame + 1, progress.totalFrames)} of ~{progress.totalFrames}</>
                ) : (
                  'Everything runs on your device'
                )}
              </p>

              <p className="progress-card__eta">
                {progress.timeRemaining !== undefined && progress.timeRemaining > 0
                  ? `About ${progress.timeRemaining}s remaining`
                  : 'This usually takes a moment'}
              </p>

              <button type="button" className="btn-ghost progress-card__cancel" onClick={handleCancel}>
                <FiX size={14} />
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="page__footer">
        <span className="pill" aria-hidden="true">
          <span className="pill__icon">⏱</span>
          {Math.round(options.maxDuration / 60)} min max
        </span>
        <span className="pill">{options.fps} fps</span>
        <span className="pill">{options.format.toUpperCase()}</span>
        {options.dedupe && <span className="pill pill--brand">Similar frames removed</span>}
      </footer>

      {/* Why this exists, stated before anything else competes for attention.
          The three points are the reasons a visitor picks this over an upload
          form, so they answer the actual objection rather than describing
          features. */}
      <section className="perks" aria-label="Why WanSnap">
        <h2 className="perks__title">Why WanSnap</h2>
        <ul className="perks__list">
          <li className="perk">
            <span className="perk__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </span>
            <h3 className="perk__name">Never uploaded</h3>
            <p className="perk__desc">
              Your video is processed on this device. Nothing is sent to a server, so private
              footage stays private.
            </p>
          </li>
          <li className="perk">
            <span className="perk__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 4.1 12.6a1 1 0 0 0 .8 1.6H11l-1 8 8.9-10.6a1 1 0 0 0-.8-1.6H12z" />
              </svg>
            </span>
            <h3 className="perk__name">Instant</h3>
            <p className="perk__desc">
              No upload queue and no waiting on a server. Frames appear as soon as the video is
              decoded.
            </p>
          </li>
          <li className="perk">
            <span className="perk__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <h3 className="perk__name">Free and clean</h3>
            <p className="perk__desc">
              No account, no watermark, no usage limit. Grab the frames you need and get on with
              it.
            </p>
          </li>
        </ul>
      </section>

      <SettingsPanel
        open={settingsOpen}
        options={options}
        duration={state.duration}
        onClose={() => setSettingsOpen(false)}
        onApply={handleApplySettings}
      />
    </div>
  );
};