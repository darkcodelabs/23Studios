// safeErr coerces anything truthy (string, Error, response-shape object) into
// a readable string so JSX never renders "[object Object]".
// Use everywhere we render an err state to text.

export function safeErr(e) {
  if (e == null || e === false) return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (e instanceof Error) {
    if (e.detail) return safeErr(e.detail);
    return e.message || 'error';
  }
  if (typeof e === 'object') {
    if (Array.isArray(e)) {
      return e.map(safeErr).filter(Boolean).join('; ');
    }
    if (typeof e.error === 'string') {
      if (Array.isArray(e.detail)) return `${e.error}: ${e.detail.join('; ')}`;
      if (typeof e.detail === 'string') return `${e.error}: ${e.detail}`;
      return e.error;
    }
    if (typeof e.message === 'string') return e.message;
    if (typeof e.detail === 'string') return e.detail;
    if (Array.isArray(e.detail)) return e.detail.join('; ');
    try { return JSON.stringify(e); } catch (_e) { return String(e); }
  }
  return String(e);
}
