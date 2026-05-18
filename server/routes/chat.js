'use strict';

const { WebSocketServer } = require('ws');

const { isAuthenticated } = require('../services/wsAuth');
const projects = require('../services/projects');
const claude = require('../services/claude');
const logBus = require('../services/logBus');
const { validateId } = require('../services/validation');

const MAX_MSG_BYTES = 64 * 1024;
const MAX_TEXT_LEN = 10000;
const CTRL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (_e) { /* ignore */ }
}

function sanitizeText(t) {
  if (typeof t !== 'string') return '';
  return t.replace(CTRL_REGEX, '').slice(0, MAX_TEXT_LEN);
}

function attachChat(wssChat) {
  wssChat.on('connection', (ws) => {
    let project = null;
    let busy = false;

    ws.on('message', async (raw) => {
      if (raw.length > MAX_MSG_BYTES) {
        send(ws, { type: 'error', message: 'message_too_large', id: 'oversize' });
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); }
      catch (_e) {
        send(ws, { type: 'error', message: 'bad_json', id: 'parse' });
        return;
      }

      if (msg.type === 'start') {
        const idErr = validateId(msg.project_id);
        if (idErr) return send(ws, { type: 'error', message: 'bad_project_id', id: 'val' });
        const p = await projects.getProject(msg.project_id);
        if (!p) return send(ws, { type: 'error', message: 'project_not_found', id: 'lookup' });
        project = p;
        const history = await claude.loadHistory(p.id, 100);
        send(ws, { type: 'history', items: history });
        send(ws, { type: 'ready', project_id: p.id });
        return;
      }

      if (msg.type === 'end') {
        try { ws.close(1000); } catch (_e) { /* ignore */ }
        return;
      }

      if (msg.type === 'message') {
        if (!project) return send(ws, { type: 'error', message: 'no_project', id: 'state' });
        if (busy) return send(ws, { type: 'error', message: 'busy', id: 'state' });
        const text = sanitizeText(msg.text);
        if (!text) return send(ws, { type: 'error', message: 'empty_text', id: 'val' });

        busy = true;
        logBus.emit(project.id, { kind: 'chat_start', text_len: text.length });

        claude.sendMessage({
          projectId: project.id,
          cwd: project.local_path,
          text,
          onChunk: (chunk) => {
            send(ws, { type: 'chunk', text: chunk });
            logBus.emit(project.id, { kind: 'chat_chunk', bytes: chunk.length });
          },
          onDone: () => {
            busy = false;
            send(ws, { type: 'done' });
            logBus.emit(project.id, { kind: 'chat_done' });
          },
          onError: (err) => {
            busy = false;
            const id = Date.now().toString(36);
            console.error('[ws/chat] err', id, err);
            send(ws, { type: 'error', message: 'chat_failed', id });
            logBus.emit(project.id, { kind: 'chat_error', id });
          }
        });
        return;
      }

      send(ws, { type: 'error', message: 'unknown_type', id: 'val' });
    });

    ws.on('close', () => { /* nothing to clean up per-message */ });
  });
}

function attachLogs(wssLogs) {
  wssLogs.on('connection', (ws, req) => {
    const projectId = req._projectId;
    const unsubscribe = logBus.subscribe(projectId, (evt) => {
      send(ws, { type: 'log', ...evt });
    });
    ws.on('close', () => unsubscribe());
    send(ws, { type: 'ready', project_id: projectId });
  });
}

async function handleUpgrade(server, wssChat, wssLogs) {
  server.on('upgrade', async (req, socket, head) => {
    const url = req.url || '';
    // Only handle the routes WE own. Other WS handlers (pulp_export,
    // sdk_preview) install their own server.on('upgrade') listeners and
    // claim the socket via wss.handleUpgrade. If we destroy the socket
    // on a non-chat URL, we race them.
    const isChat = url === '/ws/chat' || url.startsWith('/ws/chat?');
    const isLogs = /^\/ws\/logs\//.test(url);
    if (!isChat && !isLogs) return; // not ours; let another listener handle.
    const ok = await isAuthenticated(req);
    if (!ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (url === '/ws/chat' || url.startsWith('/ws/chat?')) {
      wssChat.handleUpgrade(req, socket, head, (ws) => wssChat.emit('connection', ws, req));
      return;
    }

    const m = url.match(/^\/ws\/logs\/([a-zA-Z0-9][a-zA-Z0-9-]{0,63})(?:\?.*)?$/);
    if (m) {
      const projectId = m[1];
      const project = await projects.getProject(projectId);
      if (!project) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      req._projectId = projectId;
      wssLogs.handleUpgrade(req, socket, head, (ws) => wssLogs.emit('connection', ws, req));
      return;
    }

    socket.destroy();
  });
}

function install(server) {
  const wssChat = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
  const wssLogs = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  attachChat(wssChat);
  attachLogs(wssLogs);
  handleUpgrade(server, wssChat, wssLogs);
  return { wssChat, wssLogs };
}

module.exports = { install };
