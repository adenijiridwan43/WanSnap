import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

class FFmpegService {
  private ffmpeg: FFmpeg;
  private loaded: boolean = false;
  private maxRetries = 3;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  
  async load() {
    if (!this.loaded) {
      let retries = 0;
      while (retries < this.maxRetries) {
        try {
          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.2/dist/umd';
          
          await this.ffmpeg.load({
            coreURL: await toBlobURL(
              `${baseURL}/ffmpeg-core.js`,
              'text/javascript'
            ),
            wasmURL: await toBlobURL(
              `${baseURL}/ffmpeg-core.wasm`,
              'application/wasm'
            ),
            // workerURL: await toBlobURL(
            //   `${baseURL}/ffmpeg-core.worker.js`,
            //   'text/javascript'
            // ),
          });
          
          this.loaded = true;
          break;
        } catch (error) {
          retries++;
          if (retries === this.maxRetries) {
            throw new Error('Failed to load FFmpeg after multiple attempts');
          }
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }



  async processVideo(file: File, onProgress: (progress: number) => void): Promise<string[]> {
    await this.load();

    const fileData = await file.arrayBuffer();
    const videoElement = document.createElement('video');
    videoElement.src = URL.createObjectURL(new Blob([fileData]));
    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => {
        resolve(videoElement.duration);
      };
    });
    await this.ffmpeg.writeFile('input.mp4', new Uint8Array(fileData));

    const command = [
      '-i', 'input.mp4',
        '-vf', 'fps=1',
        '-vsync', '0',
        '-frame_pts', '1',
        '-q:v', '2',
        '-threads', '4',  // Use multiple threads
        '-report',        // Enable detailed logging
        'frame-%d.jpg'
    ];

    await this.ffmpeg.exec(command);

    const screenshots: string[] = [];
    let fileIndex = 1;

    while (true) {
      try {
        onProgress((fileIndex / Math.floor(videoElement.duration)) * 100);
        const data = await this.ffmpeg.readFile(`frame-${fileIndex}.jpg`);
        const url = URL.createObjectURL(
          new Blob([data], { type: 'image/jpeg' })
        );
        screenshots.push(url);
        fileIndex++;
        onProgress((fileIndex / Math.floor(videoElement.duration)) * 100);
      } catch {
        break;
      }
    }

    return screenshots;
  }
}

export const ffmpegService = new FFmpegService()