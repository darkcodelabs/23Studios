import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Detect code-server's /proxy/<port>/ mount so router + fetch/WS resolve
// against the right base. Falls through to '' for direct localhost access.
(function detectAppBase() {
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
})();

const APP_BASE = window.__APP_BASE__ || '';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter basename={APP_BASE}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// PWA service worker. Dev hot-reload + SW caching conflict, so prod only.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${APP_BASE}/sw.js`, { scope: `${APP_BASE}/` })
      .catch((err) => console.warn('SW registration failed:', err));
  });
}
