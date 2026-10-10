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
  // 4-minute runs exhausts the tab's memory.
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

  useEffect(() => releaseFrames, [releaseFrames]);

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

      // Bound memory before doing any real work.
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
    loading: 'Loading video tools...',
    decoding: 'Extracting frames...',
    reading: 'Finishing up...',
    done: 'Done',
  };

  return (
    <div className="uploader-wrapper">
      <header className="uploader-header">
        <div className="uploader-logo">
          <div className="logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#E8734A" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" fill="#E8734A" />
              <line x1="12" y1="2" x2="12" y2="6" stroke="#E8734A" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="18" x2="12" y2="22" stroke="#E8734A" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h1 className="logo-text">
              Wan<span>Snap</span>
            </h1>
            <p className="logo-subtitle">STUDIO</p>
          </div>
        </div>
        <button
          className="settings-btn"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          disabled={state.processing}
        >
          <FiSettings size={20} />
        </button>
      </header>

      <motion.div
        className="uploader-hero"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="hero-title">
          Ready to create
          <br />
          amazing <span>Snaps</span>?
        </h2>
        <p className="hero-subtitle">Turn your videos into perfect stills.</p>
      </motion.div>

      <motion.div
        className={`upload-card ${dragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <div className="smart-badge">
          <HiOutlineSparkles size={14} />
          <span>Smart AI</span>
        </div>

        <div className="upload-icon-wrapper" onClick={() => fileInputRef.current?.click()}>
          <div className="upload-icon-ring" />
          <div className="upload-icon-circle">
            <FiPlus size={28} />
          </div>
        </div>

        <h3 className="upload-title">Upload Video</h3>
        <p className="upload-subtitle">Browse your gallery or drop a file to begin</p>

        <button
          className="choose-file-btn"
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
          style={{ display: 'none' }}
        />
      </motion.div>

      <AnimatePresence>
        {state.error && (
          <motion.div
            className="error-toast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            role="alert"
          >
            {state.error}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.processing && (
          <motion.div
            className="processing-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="processing-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
            >
              <div className="processing-spinner" />
              <h3>{phaseLabel[progress.phase]}</h3>
              <p>
                {progress.totalFrames > 0
                  ? `Frame ${progress.currentFrame} of ~${progress.totalFrames}`
                  : 'This runs entirely on your device'}
              </p>
              <div className="progress-bar-container">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(Math.max(progress.percentage, 2), 100)}%` }}
                />
              </div>
              <span className="progress-text">
                {Math.round(Math.min(progress.percentage, 100))}%
                {progress.timeRemaining !== undefined && progress.timeRemaining > 0
                  ? ` · about ${progress.timeRemaining}s left`
                  : ''}
              </span>
              <button className="cancel-btn" onClick={handleCancel}>
                <FiX size={15} /> Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="info-bar"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <span className="info-icon">⏱</span>
        <span>
          {Math.round(options.maxDuration / 60)} min max · {options.fps} fps ·{' '}
          {options.format.toUpperCase()}
          {options.dedupe ? ' · similar frames removed' : ''}
        </span>
      </motion.div>

      <SettingsPanel
        open={settingsOpen}
        options={options}
        duration={state.duration}
        onClose={() => setSettingsOpen(false)}
        onApply={handleApplySettings}
      />

      

      <style>{`
        .uploader-wrapper {
          padding: 16px;
          max-width: 600px;
          margin: 0 auto;
          width: 100%;
        }
        .uploader-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 28px;
          padding-top: 8px;
        }
        .uploader-logo { display: flex; align-items: center; gap: 10px; }
        .logo-icon {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FFF0E8, #FDDCC8);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logo-text {
          font-size: 20px;
          font-weight: 800;
          color: #2D2D3A;
          line-height: 1.1;
        }
        .logo-text span { color: #E8734A; }
        .logo-subtitle {
          font-size: 10px;
          font-weight: 600;
          color: #E8734A;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin: 0;
        }
        .settings-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #F5F0EC;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #8A8A9A;
          cursor: pointer;
          transition: all 0.2s;
        }
        .settings-btn:hover:not(:disabled) { background: #EDE6E0; color: #E8734A; }
        .settings-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .uploader-hero { margin-bottom: 28px; }
        .hero-title {
          font-size: 32px;
          font-weight: 800;
          color: #2D2D3A;
          line-height: 1.15;
          margin-bottom: 8px;
        }
        .hero-title span { color: #E8734A; }
        .hero-subtitle { font-size: 15px; color: #8A8A9A; margin: 0; }
        .upload-card {
          background: #FFFFFF;
          border-radius: 24px;
          padding: 40px 24px 32px;
          text-align: center;
          position: relative;
          box-shadow: 0 4px 30px rgba(232, 115, 74, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
          border: 2px solid transparent;
          transition: all 0.3s ease;
        }
        .upload-card.drag-over { border-color: #E8734A; background: #FFF8F5; transform: scale(1.01); }
        .smart-badge {
          position: absolute;
          top: 16px;
          right: 16px;
          display: flex;
          align-items: center;
          gap: 4px;
          background: linear-gradient(135deg, #FFF0E8, #FDDCC8);
          color: #E8734A;
          font-size: 12px;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 20px;
        }
        .upload-icon-wrapper {
          position: relative;
          width: 90px;
          height: 90px;
          margin: 0 auto 20px;
          cursor: pointer;
        }
        .upload-icon-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px dashed rgba(232, 115, 74, 0.25);
          animation: pulse-ring 2s ease-in-out infinite;
        }
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        .upload-icon-circle {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          background: linear-gradient(135deg, #E8734A, #F09468);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 6px 20px rgba(232, 115, 74, 0.35);
          transition: transform 0.2s;
        }
        .upload-icon-circle:hover { transform: scale(1.05); }
        .upload-title {
          font-size: 20px;
          font-weight: 700;
          color: #2D2D3A;
          margin-bottom: 6px;
        }
        .upload-subtitle {
          font-size: 14px;
          color: #8A8A9A;
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .choose-file-btn {
          background: #4A4A5A;
          color: white;
          border: none;
          border-radius: 30px;
          padding: 12px 36px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .choose-file-btn:hover:not(:disabled) {
          background: #3A3A4A;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .choose-file-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .error-toast {
          margin-top: 16px;
          padding: 12px 20px;
          background: #FFF0F0;
          color: #E74C4C;
          border-radius: 12px;
          font-size: 14px;
          text-align: center;
          border: 1px solid #FFD4D4;
        }
        .processing-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
          padding: 20px;
        }
        .processing-modal {
          background: white;
          border-radius: 24px;
          padding: 40px 32px;
          text-align: center;
          max-width: 340px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        }
        .processing-spinner {
          width: 48px;
          height: 48px;
          border: 3px solid #F0E6DE;
          border-top-color: #E8734A;
          border-radius: 50%;
          margin: 0 auto 20px;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .processing-modal h3 {
          font-size: 18px;
          font-weight: 700;
          color: #2D2D3A;
          margin-bottom: 4px;
        }
        .processing-modal p {
          font-size: 14px;
          color: #8A8A9A;
          margin-bottom: 20px;
        }
        .progress-bar-container {
          height: 8px;
          background: #F0E6DE;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #E8734A, #F09468);
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .progress-text { font-size: 13px; font-weight: 600; color: #E8734A; }
        .cancel-btn {
          margin-top: 20px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 20px;
          border-radius: 30px;
          border: 1px solid #F0E6DE;
          background: #F5F0EC;
          color: #8A8A9A;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .cancel-btn:hover { background: #EDE6E0; color: #E8734A; }
        .info-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 24px;
          padding: 10px 20px;
          font-size: 13px;
          color: #8A8A9A;
          font-weight: 500;
          text-align: center;
        }
        .info-icon { font-size: 16px; }

        @media (min-width: 768px) {
          .uploader-wrapper { padding: 32px; }
          .hero-title { font-size: 42px; }
          .upload-card { padding: 50px 40px 40px; }
          .upload-icon-wrapper { width: 110px; height: 110px; }
          .upload-title { font-size: 24px; }
        }
        @media (min-width: 1024px) {
          .uploader-wrapper { padding: 48px 32px; }
          .hero-title { font-size: 48px; }
          .hero-subtitle { font-size: 17px; }
          .upload-card { padding: 60px 48px 48px; }
        }
      `}</style>
    </div>
  );
};