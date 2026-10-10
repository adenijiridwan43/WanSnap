import { useState } from 'react';
import { VideoUploader } from '../components/videoUploader';
import { BottomNav } from '../components/BottomNav/BottomNav';

function Welcome() {
  const [activeTab, setActiveTab] = useState<'home' | 'profile'>('home');

  return (
    <>
      <div className="app-content">
        {activeTab === 'home' && <VideoUploader />}
        {activeTab === 'profile' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            color: '#8A8A9A',
            fontSize: '15px',
            gap: '8px'
          }}>
            <span style={{ fontSize: '40px' }}>👤</span>
            <p>Profile coming soon</p>
          </div>
        )}
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </>
  );
}

export default Welcome;
