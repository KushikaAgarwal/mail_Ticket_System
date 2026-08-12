import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forwards straight to the Node backend (server.js), which itself
      // proxies /flowable-api on to Flowable — same two-hop pattern as
      // the audit app, just through one proxy instead of two.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/flowable-api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
