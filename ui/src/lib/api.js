let csrfToken = null;

export function setCsrfToken(t) { csrfToken = t || null; }
export function getCsrfToken() { return csrfToken; }

async function request(method, url, body, opts = {}) {
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
  const res = await fetch(url, init);
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
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
  patch: (url, body, opts) => request('PATCH', url, body, opts),
  del: (url, opts) => request('DELETE', url, null, opts)
};
