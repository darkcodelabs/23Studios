import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/tokens.css';
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

// SW was retired — public/sw.js is a self-unregistering tombstone that
// fires on the next update check. Sweep any leftover registrations here
// too so a user who never reloads still gets cleaned up.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) r.unregister().catch(() => {});
  }).catch(() => {});
}
