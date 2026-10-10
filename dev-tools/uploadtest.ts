// Dev-only: verifies the full upload flow through the React UI, not just the
// service layer. Creates a fixture file and drives the real file input.
import { ffmpegService } from './ffmpeg';

async function makeFixture(): Promise<File> {
  await ffmpegService.load();
  const code = await ffmpegService.makeRawVideo(8);
  if (code !== 0) throw new Error(`fixture generation failed (exit ${code})`);
  const file = await ffmpegService.takeRawVideo();
  await ffmpegService.clearRawVideo();
  return file;
}

/** Builds a FileList containing a synthetic video and dispatches it at the input. */
export async function driveUpload(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');

  const file = await makeFixture();
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  input.dispatchEvent(new Event('change', { bubbles: true }));
  console.log('[driveUpload] dispatched', file.size, 'bytes');
}