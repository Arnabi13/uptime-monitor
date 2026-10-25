import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The app always calls relative /api/... URLs. In dev, Vite forwards them to
    // Nest; in production (Day 4) CloudFront forwards /api/* to EC2. Either way
    // the browser sees one origin, so there's no CORS preflight on every request.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
