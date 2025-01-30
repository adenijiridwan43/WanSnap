import { VideoValidationProps } from '../types';

export const validateVideo = async ({ file, maxDuration }: VideoValidationProps): Promise<{ isValid: boolean; error?: string }> => {
    const videoEl = document.createElement('video');
    const videoURL = URL.createObjectURL(file);
    
    return new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        URL.revokeObjectURL(videoURL);
        
        if (videoEl.duration > maxDuration) {
          resolve({ isValid: false, error: `Video must be ${maxDuration / 60} minutes or less` });
          return;
        }
        
        if (!file.type.startsWith('video/')) {
          resolve({ isValid: false, error: 'File must be a video format' });
          return;
        }
        
        resolve({ isValid: true });
      };
      
      videoEl.src = videoURL;
    });
  };
  