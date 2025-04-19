import React from 'react';

export const HowToUse: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto mt-20 p-6 bg-[#FEE9CE] text-black rounded-lg">
      <h2 className="text-2xl font-bold mb-4">How to Use Wan<span className='text-pink-500'>snap</span></h2>
      <div className="space-y-4">
          <h3 className="font-semibold">1. Upload Your Video</h3>
          <p>Click the upload button and select a video file (max 4 minutes)</p>
          <h3 className="font-semibold">2. Processing</h3>
          <p>Wait while Framesnap extracts screenshots from every second of your video</p>
          <h3 className="font-semibold">3. Review & Download</h3>
          <p>View the extracted screenshots and download them all as a ZIP file</p>
        <div>
          <h3 className="font-semibold">Coming Soon</h3>
          <p>Specify exact timestamps for screenshot extraction</p>
        </div>
      </div>
    </div>
  );
};
