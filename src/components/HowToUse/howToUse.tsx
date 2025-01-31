import React from 'react';

export const HowToUse: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto mt-12 p-6 bg-black rounded-lg">
      <h2 className="text-2xl font-bold mb-4">How to Use Framesnap</h2>
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold">1. Upload Your Video</h3>
          <p>Click the upload button and select a video file (max 4 minutes)</p>
        </div>
        <div>
          <h3 className="font-semibold">2. Processing</h3>
          <p>Wait while Framesnap extracts screenshots from every second of your video</p>
        </div>
        <div>
          <h3 className="font-semibold">3. Review & Download</h3>
          <p>View the extracted screenshots and download them all as a ZIP file</p>
        </div>
        <div>
          <h3 className="font-semibold">Coming Soon</h3>
          <p>Specify exact timestamps for screenshot extraction</p>
        </div>
      </div>
    </div>
  );
};
