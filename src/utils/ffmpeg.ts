import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

class FFmpegService {
  private ffmpeg: FFmpeg;
  private loaded: boolean = false;

  constructor() {
    this.ffmpeg = new FFmpeg();
  }

  
  async load() {
    if (!this.loaded) {
      try {
        // Using local files from public/ffmpeg
        await this.ffmpeg.load({
          coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
          wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
          workerURL: await toBlobURL('/ffmpeg/ffmpeg-core.worker.js', 'text/javascript'),
        });
        
        this.loaded = true;
      } catch (error) {
        console.error('Error loading FFmpeg:', error);
        throw new Error('Failed to load FFmpeg');
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