import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../App.jsx';

export default function Login() {
  const { login, authed } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { if (authed) navigate('/dashboard', { replace: true }); }, [authed, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setErr(null);
    try {
      const ok = await login(password);
      if (!ok) setErr('invalid credentials');
      else navigate('/dashboard', { replace: true });
    } catch (e2) {
      if (e2.status === 429) setErr('too many attempts. wait 15 minutes.');
      else if (e2.status === 401) setErr('invalid credentials');
      else setErr('login failed');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-ink-900 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-ink-800 border border-ink-700">
            <Lock className="w-5 h-5 text-accent" />
          </div>
          <h1 className="text-2xl font-mono text-ink-100">23 Studios</h1>
          <p className="text-xs text-ink-400">game production pipeline</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="pw" className="block text-xs uppercase tracking-wide text-ink-400">studio password</label>
          <input
            id="pw"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            className="input font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            maxLength={256}
            required
          />
        </div>

        {err ? <div className="text-xs text-red-400">{err}</div> : null}

        <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          enter
        </button>

        <p className="text-[10px] text-ink-500 text-center">
          access requires login to the host first. app binds 127.0.0.1.
        </p>
      </form>
    </div>
  );
}
