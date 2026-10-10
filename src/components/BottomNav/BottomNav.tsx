import React from 'react';
import { FiHome, FiUser } from 'react-icons/fi';

interface BottomNavProps {
  activeTab: 'home' | 'profile';
  onTabChange: (tab: 'home' | 'profile') => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="bottom-nav">
      <button
        className={`bottom-nav-item ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onTabChange('home')}
      >
        <FiHome size={22} />
        <span>Home</span>
      </button>
      <button
        className={`bottom-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
        onClick={() => onTabChange('profile')}
      >
        <FiUser size={22} />
        <span>Profile</span>
      </button>

      <style>{`
        .bottom-nav {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: 65px;
          background: #FFFFFF;
          border-top: 1px solid #F0E6DE;
          display: flex;
          justify-content: space-around;
          align-items: center;
          padding: 0 40px;
          z-index: 100;
          box-shadow: 0 -2px 20px rgba(0, 0, 0, 0.04);
        }

        .bottom-nav-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: none;
          border: none;
          cursor: pointer;
          color: #B0B0C0;
          font-size: 11px;
          font-weight: 500;
          transition: color 0.2s ease;
          padding: 6px 16px;
        }

        .bottom-nav-item.active {
          color: #E8734A;
        }

        .bottom-nav-item:hover {
          color: #E8734A;
        }
      `}</style>
    </nav>
  );
};
