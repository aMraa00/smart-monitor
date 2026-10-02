import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dashboard talks to the API through a dev proxy so the browser never has
 * to know the backend origin: same-origin requests keep CORS and the Socket.IO
 * handshake simple, and no credentials are baked into the bundle.
 */
const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:5000';

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
  // Socket.IO must be proxied with ws:true or realtime silently never connects.
  '/socket.io': { target: API_TARGET, changeOrigin: true, ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
