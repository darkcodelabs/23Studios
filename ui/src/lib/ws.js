function appBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
  return window.__APP_BASE__;
}

export function openChat({ onOpen, onMessage, onClose, onError } = {}) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}${appBase()}/ws/chat`;
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => onOpen?.());
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); }
    catch (_e) { return; }
    onMessage?.(msg);
  });
  ws.addEventListener('close', (ev) => onClose?.(ev));
  ws.addEventListener('error', (ev) => onError?.(ev));
  return ws;
}

export function send(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(JSON.stringify(obj)); return true; }
  catch (_e) { return false; }
}
