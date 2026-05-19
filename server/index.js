'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');

const { requireAuth } = require('./middleware/auth');
const { csrfProtection, csrfErrorHandler } = require('./middleware/csrf');
const { apiLimiter } = require('./middleware/rateLimit');
const authRouter = require('./routes/auth');
const projectsRouter = require('./routes/projects');
const filesRouter = require('./routes/files');
const pulpRouter = require('./routes/pulp');
const pulpAiRouter = require('./routes/pulp_ai');
const pulpAssetsRouter = require('./routes/pulp_assets');
const pulpScenesRouter = require('./routes/pulp_scenes');
const pulpPortraitsRouter = require('./routes/pulp_portraits');
const pulpExportRouter = require('./routes/pulp_export');
const pulpWorkflowRouter = require('./routes/pulp_workflow');
const pulpAutopilotRouter = require('./routes/pulp_autopilot');
const sdkAutopilotRouter = require('./routes/sdk_autopilot');
const gatesRouter = require('./routes/gates');
const stylesRouter = require('./routes/styles');
const assetLibraryRouter = require('./routes/asset_library');
const lateAddRouter = require('./routes/late_add');
const npcRouter = require('./routes/npc');
const levelsRouter = require('./routes/levels');
const minigamesRouter = require('./routes/minigames');
const openrouterRouter = require('./routes/openrouter');
const chatWs = require('./routes/chat');
const { seedDefaults } = require('./services/seed');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT, 10) || 8090;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = process.env.PROJECTS_DATA_DIR
  ? path.resolve(process.env.PROJECTS_DATA_DIR)
  : path.join(__dirname, 'data');

if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in .env');
  process.exit(1);
}
if (!process.env.STUDIO_PASSWORD) {
  console.error('FATAL: STUDIO_PASSWORD must be set in .env');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'chat_history'), { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Inline boot script: detects code-server's /proxy/<port>/ mount and sets
// <base href> + window.__APP_BASE__ BEFORE Vite's module scripts execute.
// Hash is added to CSP so the strict 'script-src' allows just this one inline.
const PROXY_BOOT_JS =
  "(function(){var m=location.pathname.match(/^(.*\\/proxy\\/\\d+)(\\/|$)/);" +
  "var b=m?m[1]+'/':'';if(b){var e=document.createElement('base');" +
  "e.setAttribute('href',b);document.head.insertBefore(e,document.head.firstChild);}" +
  "window.__APP_BASE__=m?m[1]:'';})();";
const PROXY_BOOT_HASH =
  "'sha256-" + crypto.createHash('sha256').update(PROXY_BOOT_JS).digest('base64') + "'";

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      // Allow CF beacon injected by Cloudflare when served via tunnel +
      // CF Access — they bolt static.cloudflareinsights.com onto every
      // origin response. Listing it here prevents a noisy CSP error in
      // the console without us giving up first-party isolation.
      'script-src': ["'self'", PROXY_BOOT_HASH, 'https://static.cloudflareinsights.com'],
      'script-src-elem': ["'self'", PROXY_BOOT_HASH, 'https://static.cloudflareinsights.com'],
      // PWA manifest may be re-fetched through the CF Access challenge
      // when an unauthenticated session expires; allow the CF Access
      // host so the redirect doesn't trigger a console violation.
      'manifest-src': ["'self'", 'https://hackdev.cloudflareaccess.com'],
      'style-src': ["'self'", "'unsafe-inline'"],
      // The studio bundles its own Inter font copy via @font-face
      // (added at build time); we don't need to call out to rsms.me
      // anymore. Leave style-src tight.
      // hackdev.cloudflareaccess.com allowed because CF Access wraps every
      // hakc.dev request and may redirect fetch() / SW requests through
      // its auth flow mid-session. Listing it stops the console from
      // throwing CSP errors on the redirect chain (manifest.webmanifest
      // is the most visible victim through the /proxy/8090/ path).
      'connect-src': ["'self'", 'ws:', 'wss:',
                      'https://static.cloudflareinsights.com',
                      'https://cloudflareinsights.com',
                      'https://hackdev.cloudflareaccess.com'],
      'img-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser(SESSION_SECRET));

app.use(cookieSession({
  name: 'studio_sess',
  keys: [SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'strict',
  secure: NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Silence the favicon 404 — empty 1x1 transparent gif until a real one ships.
const FAVICON = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/gif').send(FAVICON);
});

app.use('/api', apiLimiter);
app.use('/api/auth', authRouter);
app.use('/api', requireAuth, csrfProtection);
app.use(csrfErrorHandler);

app.use('/api/projects', projectsRouter);
app.use('/api/projects', filesRouter);
app.use('/api/projects', pulpRouter);
app.use('/api/projects', pulpAiRouter);
app.use('/api/projects', pulpAssetsRouter);
app.use('/api/projects', pulpScenesRouter);
app.use('/api/projects', pulpPortraitsRouter);
app.use('/api/projects', pulpExportRouter);
app.use('/api/projects', pulpWorkflowRouter);
app.use('/api/projects', pulpAutopilotRouter);
app.use('/api/projects', sdkAutopilotRouter);
app.use('/api/projects', gatesRouter);
// Phase 3 routers. styles + asset_library + late_add + npc + levels + minigames
// mix /api/styles top-level + /api/projects/:id/... endpoints, so all mount at /api.
app.use('/api', stylesRouter);
app.use('/api', assetLibraryRouter);
app.use('/api', lateAddRouter);
app.use('/api', npcRouter);
app.use('/api', levelsRouter);
app.use('/api', minigamesRouter);
app.use('/api/openrouter', openrouterRouter);

const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  // Hashed Vite assets are immutable; everything else (the rare top-level
  // file) gets no-cache so a fresh build never gets shadowed by a proxy.
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    }
  }));

  // SPA fallback. Injects a tiny inline boot script that runs BEFORE Vite's
  // module scripts execute and sets <base href> + window.__APP_BASE__ to the
  // code-server proxy mount (e.g. "/proxy/8090/"). This runs in the browser
  // because code-server's proxy doesn't reliably forward X-Forwarded-Prefix,
  // and the document URL itself is the source of truth.
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const bootedHtml = indexHtml.replace(
    '<head>',
    `<head><script>${PROXY_BOOT_JS}</script>`
  );
  app.get(/^\/(?!api|ws).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.type('html').send(bootedHtml);
  });
}

app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  console.error('[err]', id, err);
  res.status(err.status || 500).json({ error: 'server_error', id });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[23studios] listening on http://${HOST}:${PORT} (${NODE_ENV})`);
});

chatWs.install(server);
pulpExportRouter.installExportWs(server);
if (typeof sdkAutopilotRouter.installPreviewWs === 'function') {
  sdkAutopilotRouter.installPreviewWs(server);
}

seedDefaults().catch((e) => console.error('[seed]', e));

function shutdown() {
  console.log('[23studios] shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
