import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Trash2, Play, Loader2, Save } from 'lucide-react';
import { pulpApi, newSound, newSong } from '../lib/pulp_api.js';

const WAVEFORMS = ['sine', 'square', 'triangle', 'sawtooth', 'noise'];
const SAVE_DEBOUNCE_MS = 400;

let _ac = null;
function audioCtx() {
  if (typeof window === 'undefined') return null;
  if (_ac && _ac.state !== 'closed') return _ac;
  _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

function previewSound(spec) {
  const ctx = audioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const dur = Math.max(0.05, (spec.duration_ms || 200) / 1000);
  const a = (spec.envelope?.attack || 5) / 1000;
  const d = (spec.envelope?.decay || 50) / 1000;
  const s = Math.max(0, Math.min(1, spec.envelope?.sustain ?? 0.6));
  const r = (spec.envelope?.release || 80) / 1000;

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);

  if (spec.waveform === 'noise') {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    gain.gain.linearRampToValueAtTime(1, now + a);
    gain.gain.linearRampToValueAtTime(s, now + a + d);
    gain.gain.setValueAtTime(s, now + dur - r);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    src.start(now);
    src.stop(now + dur + 0.05);
    return;
  }

  const osc = ctx.createOscillator();
  osc.type = spec.waveform || 'sine';
  osc.frequency.setValueAtTime(spec.freq_start || 440, now);
  if (spec.freq_end && spec.freq_end !== spec.freq_start) {
    osc.frequency.linearRampToValueAtTime(spec.freq_end, now + dur);
  }
  osc.connect(gain);
  gain.gain.linearRampToValueAtTime(1, now + a);
  gain.gain.linearRampToValueAtTime(s, now + a + d);
  gain.gain.setValueAtTime(s, now + dur - r);
  gain.gain.linearRampToValueAtTime(0, now + dur);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

export default function PulpSounds() {
  const { project } = useOutletContext();
  const [tab, setTab] = useState('sfx');
  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-ink-700 flex items-center gap-1 px-3">
        <TabButton active={tab === 'sfx'} onClick={() => setTab('sfx')} label="SFX" />
        <TabButton active={tab === 'songs'} onClick={() => setTab('songs')} label="Songs" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'sfx' ? <SfxEditor projectId={project.id} /> : <SongEditor projectId={project.id} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-mono border-b-2 transition ${active ? 'border-accent text-accent' : 'border-transparent text-ink-400 hover:text-ink-200'}`}
    >{label}</button>
  );
}

function SfxEditor({ projectId }) {
  const [sounds, setSounds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [err, setErr] = useState(null);
  const [savingState, setSavingState] = useState('idle');
  const debounceRef = useRef(null);
  const latestRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await pulpApi.listSounds(projectId);
      setSounds(r.sounds || []);
      if (!selectedId && r.sounds?.[0]) setSelectedId(r.sounds[0].id);
    } catch (_e) { setErr('failed to load sounds'); }
  }, [projectId, selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = sounds.find((s) => s.id === selectedId) || null;

  function commit(id, patch) {
    latestRef.current = { id, patch: { ...(latestRef.current?.patch || {}), ...patch } };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    debounceRef.current = setTimeout(async () => {
      const job = latestRef.current;
      latestRef.current = null;
      if (!job) return;
      setSavingState('saving');
      try {
        const r = await pulpApi.patchSound(projectId, job.id, job.patch);
        setSounds((prev) => prev.map((s) => (s.id === job.id ? r.sound : s)));
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function updateLocal(patch) {
    if (!selected) return;
    setSounds((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
    commit(selected.id, patch);
  }

  function updateEnvelope(patch) {
    if (!selected) return;
    const env = { ...(selected.envelope || {}), ...patch };
    setSounds((prev) => prev.map((s) => (s.id === selected.id ? { ...s, envelope: env } : s)));
    commit(selected.id, { envelope: env });
  }

  async function onCreate() {
    const baseId = `sfx_${Date.now().toString(36)}`;
    try {
      const r = await pulpApi.createSound(projectId, newSound({ id: baseId, name: 'new sfx' }));
      setSounds((prev) => [...prev, r.sound]);
      setSelectedId(r.sound.id);
    } catch (e) { setErr(e.detail?.error || 'create failed'); }
  }

  async function onDelete(s) {
    if (!window.confirm(`delete sound "${s.name || s.id}"?`)) return;
    try {
      await pulpApi.deleteSound(projectId, s.id);
      setSounds((prev) => prev.filter((x) => x.id !== s.id));
      if (selectedId === s.id) setSelectedId(null);
    } catch (e) { setErr(e.detail?.error || 'delete failed'); }
  }

  return (
    <div className="h-full grid grid-cols-[220px_1fr]">
      <aside className="border-r border-ink-700 overflow-y-auto p-2 space-y-1">
        <button className="btn-primary w-full text-xs" onClick={onCreate}>
          <Plus className="w-3.5 h-3.5" /> new sfx
        </button>
        {sounds.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded ${selectedId === s.id ? 'bg-ink-700 text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
          >
            <div className="truncate">{s.name || '(unnamed)'}</div>
            <div className="text-[10px] text-ink-500 truncate">{s.id}</div>
          </button>
        ))}
      </aside>

      <section className="overflow-y-auto p-4 space-y-3 max-w-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-ink-400">sfx editor</h3>
          <div className="text-[10px] text-ink-500 flex items-center gap-1">
            {savingState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> saving</> : null}
            {savingState === 'saved' ? <><Save className="w-3 h-3" /> saved</> : null}
            {savingState === 'dirty' ? 'edited' : null}
            {savingState === 'error' ? <span className="text-red-400">error</span> : null}
          </div>
        </div>
        {!selected ? (
          <div className="text-ink-500 text-sm">select or create a sfx</div>
        ) : (
          <>
            <Field label="name"><input className="input text-sm" value={selected.name || ''} onChange={(e) => updateLocal({ name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="waveform">
                <select className="input text-sm" value={selected.waveform || 'sine'} onChange={(e) => updateLocal({ waveform: e.target.value })}>
                  {WAVEFORMS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="duration (ms)">
                <input type="number" min={10} max={5000} className="input text-sm" value={selected.duration_ms || 200} onChange={(e) => updateLocal({ duration_ms: parseInt(e.target.value, 10) || 200 })} />
              </Field>
              <Field label="freq start (Hz)">
                <input type="number" min={20} max={8000} className="input text-sm" value={selected.freq_start || 440} onChange={(e) => updateLocal({ freq_start: parseFloat(e.target.value) || 440 })} />
              </Field>
              <Field label="freq end (Hz)">
                <input type="number" min={20} max={8000} className="input text-sm" value={selected.freq_end || 440} onChange={(e) => updateLocal({ freq_end: parseFloat(e.target.value) || 440 })} />
              </Field>
            </div>
            <div className="space-y-1">
              <h4 className="text-[10px] uppercase tracking-wide text-ink-500">envelope (ms / 0–1)</h4>
              <div className="grid grid-cols-4 gap-2">
                <EnvField label="attack" value={selected.envelope?.attack ?? 5} onChange={(v) => updateEnvelope({ attack: v })} />
                <EnvField label="decay" value={selected.envelope?.decay ?? 50} onChange={(v) => updateEnvelope({ decay: v })} />
                <EnvField label="sustain" value={selected.envelope?.sustain ?? 0.6} step={0.01} max={1} onChange={(v) => updateEnvelope({ sustain: v })} />
                <EnvField label="release" value={selected.envelope?.release ?? 80} onChange={(v) => updateEnvelope({ release: v })} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button className="btn-primary text-xs" onClick={() => previewSound(selected)}>
                <Play className="w-3.5 h-3.5" /> preview
              </button>
              <button className="btn text-xs text-red-400 border-red-900/60 ml-auto" onClick={() => onDelete(selected)}>
                <Trash2 className="w-3.5 h-3.5" /> delete
              </button>
            </div>
          </>
        )}
        {err ? <div className="text-xs text-red-400">{err}</div> : null}
      </section>
    </div>
  );
}

function SongEditor({ projectId }) {
  const [songs, setSongs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [err, setErr] = useState(null);
  const [savingState, setSavingState] = useState('idle');
  const [tracksText, setTracksText] = useState('');
  const debounceRef = useRef(null);
  const latestRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await pulpApi.listSongs(projectId);
      setSongs(r.songs || []);
      if (!selectedId && r.songs?.[0]) setSelectedId(r.songs[0].id);
    } catch (_e) { setErr('failed to load songs'); }
  }, [projectId, selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = songs.find((s) => s.id === selectedId) || null;

  useEffect(() => {
    setTracksText(selected ? JSON.stringify(selected.tracks || [[]], null, 2) : '');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function commit(id, patch) {
    latestRef.current = { id, patch: { ...(latestRef.current?.patch || {}), ...patch } };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    debounceRef.current = setTimeout(async () => {
      const job = latestRef.current;
      latestRef.current = null;
      if (!job) return;
      setSavingState('saving');
      try {
        const r = await pulpApi.patchSong(projectId, job.id, job.patch);
        setSongs((prev) => prev.map((s) => (s.id === job.id ? r.song : s)));
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function updateLocal(patch) {
    if (!selected) return;
    setSongs((prev) => prev.map((s) => (s.id === selected.id ? { ...s, ...patch } : s)));
    commit(selected.id, patch);
  }

  function onTracksBlur() {
    if (!selected) return;
    let parsed;
    try { parsed = JSON.parse(tracksText); }
    catch (_e) { setErr('tracks: invalid JSON'); return; }
    if (!Array.isArray(parsed)) { setErr('tracks must be an array'); return; }
    setErr(null);
    updateLocal({ tracks: parsed });
  }

  async function onCreate() {
    const baseId = `song_${Date.now().toString(36)}`;
    try {
      const r = await pulpApi.createSong(projectId, newSong({ id: baseId, name: 'new song' }));
      setSongs((prev) => [...prev, r.song]);
      setSelectedId(r.song.id);
    } catch (e) { setErr(e.detail?.error || 'create failed'); }
  }

  async function onDelete(s) {
    if (!window.confirm(`delete song "${s.name || s.id}"?`)) return;
    try {
      await pulpApi.deleteSong(projectId, s.id);
      setSongs((prev) => prev.filter((x) => x.id !== s.id));
      if (selectedId === s.id) setSelectedId(null);
    } catch (e) { setErr(e.detail?.error || 'delete failed'); }
  }

  return (
    <div className="h-full grid grid-cols-[220px_1fr]">
      <aside className="border-r border-ink-700 overflow-y-auto p-2 space-y-1">
        <button className="btn-primary w-full text-xs" onClick={onCreate}>
          <Plus className="w-3.5 h-3.5" /> new song
        </button>
        {songs.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded ${selectedId === s.id ? 'bg-ink-700 text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
          >
            <div className="truncate">{s.name || '(unnamed)'}</div>
            <div className="text-[10px] text-ink-500 truncate">{s.id}</div>
          </button>
        ))}
      </aside>

      <section className="overflow-y-auto p-4 space-y-3 max-w-3xl">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-ink-400">song editor</h3>
          <div className="text-[10px] text-ink-500 flex items-center gap-1">
            {savingState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> saving</> : null}
            {savingState === 'saved' ? <><Save className="w-3 h-3" /> saved</> : null}
            {savingState === 'dirty' ? 'edited' : null}
            {savingState === 'error' ? <span className="text-red-400">error</span> : null}
          </div>
        </div>
        {!selected ? (
          <div className="text-ink-500 text-sm">select or create a song</div>
        ) : (
          <>
            <Field label="name"><input className="input text-sm" value={selected.name || ''} onChange={(e) => updateLocal({ name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="bpm">
                <input type="number" min={20} max={400} className="input text-sm" value={selected.bpm || 120} onChange={(e) => updateLocal({ bpm: parseInt(e.target.value, 10) || 120 })} />
              </Field>
              <Field label="loop from (step)">
                <input type="number" min={0} className="input text-sm" value={selected.loop_from || 0} onChange={(e) => updateLocal({ loop_from: parseInt(e.target.value, 10) || 0 })} />
              </Field>
            </div>
            <Field label="tracks (JSON; piano-roll editor in a later phase)">
              <textarea
                className="input font-mono text-xs"
                rows={14}
                value={tracksText}
                onChange={(e) => setTracksText(e.target.value)}
                onBlur={onTracksBlur}
              />
            </Field>
            <div className="flex gap-2">
              <button className="btn text-xs text-red-400 border-red-900/60 ml-auto" onClick={() => onDelete(selected)}>
                <Trash2 className="w-3.5 h-3.5" /> delete
              </button>
            </div>
          </>
        )}
        {err ? <div className="text-xs text-red-400">{err}</div> : null}
      </section>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function EnvField({ label, value, onChange, step = 1, max = 10000 }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      <input
        type="number"
        className="input text-sm"
        value={value}
        step={step}
        min={0}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}
