import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER = process.env.SERVER_URL || 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  server: {
    host: true,
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': SERVER,
      '/avatars': SERVER,
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
});
