import React from 'react';

interface ScreenshotGridProps {
  screenshots: string[];
}

export const ScreenshotGrid: React.FC<ScreenshotGridProps> = ({ screenshots }) => {
  return (
    <div className="grid grid-cols-5 gap-4 mb-4">
      {screenshots.map((url, index) => (
        <img
          key={index}
          src={url}
          alt={`Screenshot ${index + 1}`}
          className="w-20 h-20 object-cover rounded"
        />
      ))}
    </div>
  );
};