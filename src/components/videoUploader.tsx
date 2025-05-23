import React, { useState, useRef } from 'react';
import { Button, Modal, Progress } from '@nextui-org/react';
import { AiOutlineUpload } from 'react-icons/ai';
import { VideoState } from '../types/index';
import { validateVideo } from '../utils/validators';
import { ffmpegService } from '../utils/ffmpeg';
import { ScreenshotGrid } from '../components/Grid/ScreenshotGrid';
import { DownloadButton } from '../components/Download/DownloadButton';


export const VideoUploader: React.FC = () => {
  const [state, setState] = useState<VideoState>({
    file: null,
    duration: 0,
    processing: false,
    screenshots: [],
    error: null
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    
    try {
      if (!file) {
        throw new Error('No file selected');
      }
  
      // Reset state before processing
      setState(prev => ({
        ...prev,
        file: null,
        processing: false,
        screenshots: [],
        error: null
      }));
  
      // Validate video format and duration
      const validation = await validateVideo({ file, maxDuration: 240 });
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
  
      // Start processing
      setState(prev => ({ ...prev, file, processing: true }));
      
      // Process video and get screenshots
      const screenshots = await ffmpegService.processVideo(file, setProgress);
      
      if (screenshots.length === 0) {
        throw new Error('Failed to extract screenshots from video');
      }
  
      setState(prev => ({ ...prev, screenshots, processing: false }));
  
    } catch (error) {
      console.error('Video processing error:', error);
      
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
  
      // Set appropriate error message based on error type
      let errorMessage = 'Failed to process video';
      
      if (error instanceof Error) {
        switch (error.message) {
          case 'No file selected':
            errorMessage = 'Please select a video file';
            break;
          case 'Failed to load FFmpeg':
            errorMessage = 'Video processing tools failed to load. Please try again';
            break;
          case 'Failed to extract screenshots from video':
            errorMessage = 'Could not extract screenshots from this video. Please try another file';
            break;
          default:
            errorMessage = error.message || 'Unknown error occurred';
        }
      }
  
      setState(prev => ({
        ...prev,
        file: null,
        processing: false,
        screenshots: [],
        error: errorMessage
      }));
    }
  };

  return (
    <div className=" mx-auto p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Wan<span className='text-pink-500'>Snap</span></h1>
        <p className="text-gray-600">
          Extract screenshots from your videos - Perfect for ease analysis.
          No moment of your video will be lost.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button
          color="primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={state.processing}
        >
         <AiOutlineUpload /> Upload Video (Max 4 mins)
        </Button>
        
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="video/*"
          className="hidden"
        />
        
        {state.error && (
          <div className="text-red-500 mt-2">{state.error}</div>
        )}
        
        {state.processing && (
          <Modal isOpen={true} onClose={() => {}}>
            <Modal>
              <Progress value={progress} color="primary" />
              <p className="text-center">Processing video...</p>
            </Modal>
          </Modal>
        )}
        
        {state.screenshots.length > 0 && (
          <div className="w-full">
            <ScreenshotGrid screenshots={state.screenshots} />
            <DownloadButton screenshots={state.screenshots} />
          </div>
        )}
      </div>
    </div>
  );
};