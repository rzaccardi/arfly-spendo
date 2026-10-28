import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Prefer local API (npm run dev) with DATABASE_URL → DO prod so admin cookies work on localhost.
    // Alternative: point target at https://spendo.onarfly.com (cross-origin cookies may break login).
    proxy: {
      '/admin/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
