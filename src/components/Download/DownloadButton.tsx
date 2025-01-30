import React from 'react';
import { Button } from '@nextui-org/react';
import { AiOutlineDownload } from 'react-icons/ai';
import JSZip from 'jszip';

interface DownloadButtonProps {
  screenshots: string[];
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({ screenshots }) => {
  const downloadScreenshots = async () => {
    const zip = new JSZip();
    
    await Promise.all(
      screenshots.map(async (url, index) => {
        const response = await fetch(url);
        const blob = await response.blob();
        zip.file(`screenshot-${index + 1}.jpg`, blob);
      })
    );
    
    const content = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = URL.createObjectURL(content);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'screenshots.zip';
    link.click();
    
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <Button
      color="success"
      onPointerDown={downloadScreenshots}
      className="mt-4"
    >
      <AiOutlineDownload />Download All Screenshots
    </Button>
  );
};