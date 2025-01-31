// src/types/index.ts

export interface VideoState {
    file: File | null;
    duration: number;
    processing: boolean;
    screenshots: string[];
    error: string | null;
  }
  
  export interface VideoValidationProps {
    file: File;
    maxDuration: number;
  }
  
  export interface Duration {
    hours: number;
    minutes: number;
    seconds: number;
  }
  
  export interface TimeStamp {
    start: Duration;
    end?: Duration;
  }
  
  export interface ScreenshotRequest {
    timestamp: TimeStamp;
    file: File;
  }
  
  export interface ProcessingOptions {
    customTimestamps?: TimeStamp[];
    fps?: number;
    quality?: number; // 1-31, lower is better
    maxDuration: number;
  }
  
  export interface VideoMetadata {
    duration: Duration;
    fileSize: number;
    format: string;
    dimensions: {
      width: number;
      height: number;
    };
  }
  
  export interface ProcessingProgress {
    percentage: number;
    currentFrame: number;
    totalFrames: number;
    timeRemaining?: number;
  }