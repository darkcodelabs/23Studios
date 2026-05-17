'use strict';

const path = require('path');
const fs = require('fs');

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
const pulpExportRouter = require('./routes/pulp_export');
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

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'", 'ws:', 'wss:'],
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

app.use('/api', apiLimiter);
app.use('/api/auth', authRouter);
app.use('/api', requireAuth, csrfProtection);
app.use(csrfErrorHandler);

app.use('/api/projects', projectsRouter);
app.use('/api/projects', filesRouter);
app.use('/api/projects', pulpRouter);
app.use('/api/projects', pulpAiRouter);
app.use('/api/projects', pulpExportRouter);
app.use('/api/openrouter', openrouterRouter);

const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|ws).*/, (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
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

seedDefaults().catch((e) => console.error('[seed]', e));

function shutdown() {
  console.log('[23studios] shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
