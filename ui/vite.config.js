import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Absolute base so asset paths resolve from origin root regardless of the
  // current URL. The server's strip-/proxy/<port>/ middleware + the inline
  // boot script in index.html together handle the code-server tunnel — but
  // when the SW caches a stale shell without the boot script, relative
  // './assets/...' paths resolved against /proxy/8090/project/<id>/ and
  // returned text/html via SPA fallback. Absolute paths bypass that entirely.
  base: '/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8090', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:8090', ws: true, changeOrigin: false }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
