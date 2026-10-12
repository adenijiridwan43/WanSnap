import React from 'react';
import { FiHome, FiUser } from 'react-icons/fi';
import './BottomNav.css';

interface BottomNavProps {
  activeTab: 'home' | 'profile';
  onTabChange: (tab: 'home' | 'profile') => void;
}

const TABS: Array<{ id: 'home' | 'profile'; label: string; Icon: typeof FiHome }> = [
  { id: 'home', label: 'Home', Icon: FiHome },
  { id: 'profile', label: 'Profile', Icon: FiUser },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => (
  <nav className="tabbar" aria-label="Main">
    {TABS.map(({ id, label, Icon }) => (
      <button
        key={id}
        type="button"
        className={`tabbar__item ${activeTab === id ? 'is-active' : ''}`}
        onClick={() => onTabChange(id)}
        aria-current={activeTab === id ? 'page' : undefined}
      >
        <span className="tabbar__icon">
          <Icon size={21} strokeWidth={activeTab === id ? 2.4 : 2} />
        </span>
        <span className="tabbar__label">{label}</span>
      </button>
    ))}
  </nav>
);