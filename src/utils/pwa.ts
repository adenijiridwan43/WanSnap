// src/utils/pwa.ts

const SW_URL = '/sw.js';

/**
 * Registers the service worker.
 *
 * Only in production: a worker in dev would serve stale modules and make hot
 * reload behave unpredictably.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) {
    console.info('[pwa] service worker skipped in development');
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: '/' })
      .then((registration) => {
        console.log('[pwa] service worker registered', registration.scope);
      })
      .catch((error) => {
        // The app is fully usable without it; offline support is a bonus.
        console.warn('[pwa] registration failed:', error);
      });
  });
}

export type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Captures the install prompt.
 *
 * Chrome fires `beforeinstallprompt` only when the app meets its install
 * criteria, and only once, so the event has to be captured eagerly or it is
 * lost. Deferred until first user interaction because it is not part of this
 * milestone's UI.
 */
export function captureInstallPrompt(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    (window as unknown as { __wansnapInstallPrompt?: InstallPrompt }).__wansnapInstallPrompt =
      event as InstallPrompt;
    document.documentElement.dataset.installable = 'true';
    console.log('[pwa] install prompt captured');
  });

  window.addEventListener('appinstalled', () => {
    delete (window as unknown as { __wansnapInstallPrompt?: InstallPrompt }).__wansnapInstallPrompt;
    document.documentElement.dataset.installable = 'false';
    console.log('[pwa] installed');
  });
}