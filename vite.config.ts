import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The bundled core is the single-threaded `@ffmpeg/core`, which does not use
// SharedArrayBuffer and therefore does not require cross-origin isolation. These
// headers are still set because they cost nothing and are what a multi-threaded
// core (or a host that strips them) would need.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin'
}

// Tailwind v4 ships a Vite plugin; no tailwind.config.js / postcss config needed.
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Deployed under a subpath on GitHub Pages (/WanSnap/), which is the root of
  // that deployment. Set BASE_PATH by the deploy workflow; local dev stays "/".
  base: process.env.BASE_PATH ?? '/',
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
      input: {
        main: 'index.html',
        // Emitted as sw.js, matching the registration URL in src/utils/pwa.ts.
        sw: 'src/sw.ts'
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        manualChunks: {
          ffmpeg: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
        }
      }
    }
  }
})