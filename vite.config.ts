import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// FFmpeg's multi-threaded WASM build needs the page to be cross-origin isolated.
// These headers are what enable `SharedArrayBuffer`; without them FFmpeg silently
// fails to load in preview and in production.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin'
}

// Tailwind v4 ships a Vite plugin; no tailwind.config.js / postcss config needed.
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core']
  },
  server: {
    headers: crossOriginIsolation
  },
  // `vite preview` must isolate too, otherwise the built app appears to work in
  // dev and then fails every FFmpeg load when served locally.
  preview: {
    headers: crossOriginIsolation
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          ffmpeg: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
        }
      }
    }
  }
})