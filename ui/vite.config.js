import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Strip the `crossorigin` attribute Vite emits on <script type="module"> and
// <link rel="stylesheet">. Behind Cloudflare Access, crossorigin makes the
// browser fetch sub-resources without credentials, so CF Access doesn't see
// the user's JWT cookie and 302's to its login page — assets 404 in console.
// Stripping it makes the browser send same-origin cookies, CF lets them
// through.
function stripCrossoriginPlugin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin(=[^ >]+)?/g, '');
    }
  };
}

export default defineConfig({
  // Absolute base so asset paths resolve from origin root regardless of the
  // current URL. The server's strip-/proxy/<port>/ middleware + the inline
  // boot script in index.html together handle the code-server tunnel — but
  // when the SW caches a stale shell without the boot script, relative
  // './assets/...' paths resolved against /proxy/8090/project/<id>/ and
  // returned text/html via SPA fallback. Absolute paths bypass that entirely.
  // Relative base so <link href="./assets/..."> and <script src="./assets/...">
  // emit. The inline boot script in index.html (server/index.js PROXY_BOOT_JS)
  // sets <base href> per request context — '/proxy/<port>/' when behind
  // code-server tunnel, '/' direct. Relative + base href = correct resolution
  // for both deployment paths from ONE bundle.
  base: './',
  plugins: [react(), stripCrossoriginPlugin()],
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
