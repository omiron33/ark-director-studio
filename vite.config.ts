import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.STUDIO_PORT ?? 5320}`;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: true,
    port: 5321,
    proxy: {
      '/api': api,
      '/media': api,
      '/ws': { target: api.replace('http', 'ws'), ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
