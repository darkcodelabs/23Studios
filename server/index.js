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
const extractRouter = require('./routes/extract');
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
const mvpRouter = require('./routes/mvp');
const phase6Router = require('./routes/phase6');
const stylesRouter = require('./routes/styles');
const assetLibraryRouter = require('./routes/asset_library');
const referencesRouter = require('./routes/references');
const galleryRouter = require('./routes/gallery');
const lateAddRouter = require('./routes/late_add');
const npcRouter = require('./routes/npc');
const levelsRouter = require('./routes/levels');
const minigamesRouter = require('./routes/minigames');
const decisionsRouter = require('./routes/decisions');
const driftRouter = require('./routes/drift');
const interviewRouter = require('./routes/interview');
const openrouterRouter = require('./routes/openrouter');
const costRouter = require('./routes/cost');
const lintRouter = require('./routes/lint');
const approvalsRouter = require('./routes/approvals');
const agentsRouter = require('./routes/agents');
const canonRouter = require('./routes/canon');
const coverageRouter = require('./routes/coverage');
const gatesRouter = require('./routes/gates');
const graphRouter = require('./routes/graph');
const linkedDocsRouter = require('./routes/linked_docs');
const scopeRouter = require('./routes/scope');
const shipRouter = require('./routes/ship');
const releasesRouter = require('./routes/releases');
const cardMetaRouter = require('./routes/card_meta');
const designRouter = require('./routes/design');
const conceptsRouter = require('./routes/concepts');
const milestonesRouter = require('./routes/milestones');
const bibleRouter = require('./routes/bible');
const regenRouter = require('./routes/regen');
const reviewBoardRouter = require('./routes/review_board');
const batchesRouter = require('./routes/batches');
const perfRouter = require('./routes/perf');
const architectureRouter = require('./routes/architecture');
const qualityReportsRouter = require('./routes/quality_reports');
const buildEventsRouter = require('./routes/build_events');
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
  "var b=m?m[1]+'/':'/';var e=document.createElement('base');" +
  "e.setAttribute('href',b);document.head.insertBefore(e,document.head.firstChild);" +
  "window.__APP_BASE__=m?m[1]:'';})();";
const PROXY_BOOT_HASH =
  "'sha256-" + crypto.createHash('sha256').update(PROXY_BOOT_JS).digest('base64') + "'";

// Self-healing kill switch lives in ui/index.html — read it at boot, hash it,
// add to CSP so it can run. Lets us bump the KILL_VERSION inside that script
// without manually updating the CSP whitelist.
function computeKillSwitchHash() {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) return null;
    return "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'";
  } catch (_e) { return null; }
}
const KILL_SWITCH_HASH = computeKillSwitchHash();
const INLINE_SCRIPT_HASHES = [PROXY_BOOT_HASH];
if (KILL_SWITCH_HASH && KILL_SWITCH_HASH !== PROXY_BOOT_HASH) {
  INLINE_SCRIPT_HASHES.push(KILL_SWITCH_HASH);
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      // Allow CF beacon injected by Cloudflare when served via tunnel +
      // CF Access — they bolt static.cloudflareinsights.com onto every
      // origin response. Listing it here prevents a noisy CSP error in
      // the console without us giving up first-party isolation.
      'script-src': ["'self'", ...INLINE_SCRIPT_HASHES, 'https://static.cloudflareinsights.com'],
      'script-src-elem': ["'self'", ...INLINE_SCRIPT_HASHES, 'https://static.cloudflareinsights.com'],
      // PWA manifest may be re-fetched through the CF Access challenge
      // when an unauthenticated session expires; allow the CF Access
      // host so the redirect doesn't trigger a console violation.
      'manifest-src': ["'self'", 'https://hackdev.cloudflareaccess.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'style-src-elem': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
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
      'img-src': ["'self'", 'data:', 'blob:'],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Strip code-server's `/proxy/<port>/` prefix before any route matches.
// When the user accesses the studio via hakc.dev/proxy/8090/... (code-server
// tunnel), URLs like /proxy/8090/assets/index.css fall through the static
// mount (which serves /assets/*) and hit the SPA fallback — which returns
// text/html. Browser sees CSS request returning HTML, refuses to apply,
// blank page. Same for /proxy/8090/manifest.webmanifest. Rewrite at the
// edge so the rest of the app sees the canonical path.
app.use((req, _res, next) => {
  const m = req.url.match(/^(\/proxy\/\d+)(\/.*)?$/);
  if (m) {
    req.proxyPrefix = m[1];                 // stash for HTML rewriter
    req.url = m[2] || '/';
    if (req.originalUrl) req.originalUrl = req.url;
  }
  next();
});

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
app.use('/api/projects', extractRouter);
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
app.use('/api/projects', mvpRouter);
// Phase 6 — storyboard / scene-manager / authoring IDE endpoints.
app.use('/api/projects', phase6Router);
// Phase 3 routers. styles + asset_library + late_add + npc + levels + minigames
// mix /api/styles top-level + /api/projects/:id/... endpoints, so all mount at /api.
app.use('/api', stylesRouter);
app.use('/api', assetLibraryRouter);
app.use('/api', referencesRouter);
app.use('/api', lateAddRouter);
app.use('/api', npcRouter);
app.use('/api', levelsRouter);
app.use('/api', minigamesRouter);
app.use('/api', decisionsRouter);
app.use('/api', driftRouter);
// Phase 6 A5 — interactive interview (under /api/projects/:id/interview/...).
app.use('/api/projects', interviewRouter);
app.use('/api/openrouter', openrouterRouter);
app.use('/api', costRouter);
app.use('/api', lintRouter);
app.use('/api', approvalsRouter);
app.use('/api', agentsRouter);
app.use('/api', canonRouter);
app.use('/api/projects', coverageRouter);
app.use('/api/projects', gatesRouter);
app.use('/api/projects', graphRouter);
app.use('/api', linkedDocsRouter);
app.use('/api/projects', scopeRouter);
app.use('/api', shipRouter);
app.use('/api/projects', releasesRouter);
app.use('/api/projects', cardMetaRouter);
// quality_reports MUST mount before designRouter / perfRouter /
// architectureRouter so its GET stubs return 200 even when the underlying
// report file is missing. POST routes still flow to those older routers
// because they only define POST handlers for the same paths (no overlap).
app.use('/api/projects', qualityReportsRouter);
app.use('/api/projects', designRouter);
app.use('/api/projects', conceptsRouter);
app.use('/api/projects', milestonesRouter);
app.use('/api/projects', bibleRouter);
app.use('/api/projects', regenRouter);
app.use('/api/projects', reviewBoardRouter);
app.use('/api/projects', batchesRouter);
app.use('/api/projects', galleryRouter);
app.use('/api/projects', perfRouter);
app.use('/api/projects', architectureRouter);
// SSE: GET /api/projects/:id/build/events — Building screen push feed.
app.use('/api/projects', buildEventsRouter);

const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  // Vite emits relative asset paths like ./assets/index-X.css. With nested
  // SPA routes (/projects/:id/<section>/<item>), the browser's preload
  // scanner fetches those links BEFORE the inline boot script can set
  // <base href>, so the URL resolves against the document URL and we get
  // e.g. /projects/hakcd-v2/author/assets/foo.css. SPA fallback then
  // returns the index HTML with text/html MIME and the browser refuses
  // to apply the stylesheet. Fix: rewrite any request whose path ends in
  // .../assets/<file> or .../icons/<file> down to the canonical
  // /assets/<file> or /icons/<file> before express.static sees it.
  app.use((req, res, next) => {
    const m = req.path.match(/^\/(?:[^/]+\/)*(assets|icons)\/(.+)$/);
    if (m) {
      req.url = `/${m[1]}/${m[2]}`;
    }
    next();
  });

  // Hashed Vite assets are immutable; everything else (the rare top-level
  // file) gets no-cache so a fresh build never gets shadowed by a proxy.
  // Only hash-named Vite output (e.g., index-AbCd1234.js, react-XxYy.css)
  // gets `immutable` — those carry a content hash and never change in place.
  // Plain-named assets (studio-logo.png, sw.js) get a short cache so a re-copy
  // actually reaches the browser. Without this fix, a logo refresh requires
  // a query-string cache-bust on every <img src>.
  const HASHED_ASSET_RE = /[-.][A-Za-z0-9_]{6,}\.(?:js|css|woff2?)$/;
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`) && HASHED_ASSET_RE.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
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
  const BUILD_MARKER = new Date().toISOString();
  app.get(/^\/(?!api|ws).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('X-Build-Marker', BUILD_MARKER);
    // When the request came in via /proxy/<port>/..., the CF Access policy
    // only allows that prefix — bare /assets/* gets 302'd to login. Rewrite
    // every src/href starting with "/" to include the proxy prefix so the
    // browser asks /proxy/<port>/assets/... which CF Access lets through.
    if (req.proxyPrefix) {
      // Force-bust the browser's HTTP cache + storage for the origin on
      // the next HTML fetch via /proxy/<port>/. Triggers a full wipe of
      // cached HTML, SW, IndexedDB, etc. — equivalent to DevTools "Clear
      // site data" but server-driven. Set only on tunnel HTML responses,
      // never on assets (would nuke the asset itself).
      res.setHeader('Clear-Site-Data', '"cache", "storage"');
      const prefix = req.proxyPrefix;
      const rewritten = bootedHtml
        .replace(/(src|href)="\/(?!\/)/g, `$1="${prefix}/`)
        .replace(/href="manifest\.webmanifest"/g, `href="${prefix}/manifest.webmanifest"`);
      return res.type('html').send(rewritten);
    }
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
