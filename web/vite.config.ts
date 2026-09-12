import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Vite root is web/. Output lands in web/dist, served by both targets as static assets.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
