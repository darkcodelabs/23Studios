let csrfToken = null;

export function setCsrfToken(t) { csrfToken = t || null; }
export function getCsrfToken() { return csrfToken; }

// Honour code-server's /proxy/<port> prefix (set in main.jsx).
function getAppBase() {
  if (typeof window === 'undefined') return '';
  if (window.__APP_BASE__ !== undefined) return window.__APP_BASE__;
  const m = window.location.pathname.match(/^(.*\/proxy\/\d+)(\/|$)/);
  window.__APP_BASE__ = m ? m[1] : '';
  return window.__APP_BASE__;
}
function prefixed(u) {
  if (typeof u !== 'string' || !u.startsWith('/')) return u;
  const b = getAppBase();
  return b ? b + u : u;
}

async function request(method, url, body, opts = {}) {
  if (!opts.__urlPrefixed) url = prefixed(url);
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  const init = {
    method,
    credentials: 'same-origin',
    headers,
    signal: opts.signal
  };
  if (body !== undefined && body !== null) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  let res = await fetch(url, init);
  const ct = res.headers.get('content-type') || '';
  let isJson = ct.includes('application/json');

  // Stale CSRF: refresh once + replay. Common when the cookie-session rotates
  // or the user has the tab open across a deploy.
  if (res.status === 403 && !opts.__csrfRetried) {
    let detail = null;
    try { detail = isJson ? await res.clone().json() : null; } catch (_e) { /* ignore */ }
    if (detail && detail.error === 'invalid_csrf') {
      try {
        const me = await fetch(prefixed('/api/auth/me'), { credentials: 'same-origin' }).then(r => r.json());
        if (me && me.csrf_token) {
          setCsrfToken(me.csrf_token);
          return request(method, url, body, { ...opts, __csrfRetried: true, __urlPrefixed: true });
        }
      } catch (_e) { /* fall through to throw below */ }
    }
  }

  if (!res.ok) {
    let detail = null;
    try { detail = isJson ? await res.json() : await res.text(); } catch (_e) { /* ignore */ }
    const err = new Error(`http_${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return isJson ? res.json() : res.text();
}

export const api = {
  get: (url, opts) => request('GET', url, null, opts),
  post: (url, body, opts) => request('POST', url, body, opts),
  put: (url, body, opts) => request('PUT', url, body, opts),
  patch: (url, body, opts) => request('PATCH', url, body, opts),
  del: (url, opts) => request('DELETE', url, null, opts)
};
