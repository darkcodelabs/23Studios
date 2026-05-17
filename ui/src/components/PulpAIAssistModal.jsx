import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Sparkles, Play, Undo2, Check, Trash2 } from 'lucide-react';
import {
  pulpAi,
  decodeImageToPixels,
  FALLBACK_IMAGE_MODELS,
  filterImageModels
} from '../lib/pulp_ai_client.js';
import { rasterizeFrame } from '../lib/pulp_api.js';

const STYLE_PRESET = '1-bit Playdate sprite, high contrast, pure black and white, no anti-aliasing, centered on transparent background';

const TITLES = {
  'tile-art': 'generate tile art',
  'script': 'generate pulpscript',
  'room-layout': 'generate room layout',
  'sound': 'generate sound effect'
};

// ---------------- inline Web Audio preview (mirrors PulpSounds.previewSound) -------
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

// ----------------------------------------------------------------------------------

export default function PulpAIAssistModal({ kind, projectId, context = {}, onAccept, onClose }) {
  const [prompt, setPrompt] = useState(context.initialPrompt || '');
  const [model, setModel] = useState(FALLBACK_IMAGE_MODELS[0]);
  const [modelOptions, setModelOptions] = useState(FALLBACK_IMAGE_MODELS);
  const [usePreset, setUsePreset] = useState(true);
  const [pendingTileIds, setPendingTileIds] = useState(() => new Set(context.available_tile_ids || []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // history is most-recent-last; current is the last item until user steps back
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const promptRef = useRef(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Try to populate image-gen models from OpenRouter (best-effort, public).
  useEffect(() => {
    if (kind !== 'tile-art') return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/models', { credentials: 'omit' });
        if (!r.ok) return;
        const j = await r.json();
        const list = filterImageModels(j.data || j.models || []);
        if (alive && list.length) {
          setModelOptions(list);
          if (!list.includes(model)) setModel(list[0]);
        }
      } catch (_e) { /* fall back to static */ }
    })();
    return () => { alive = false; };
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = historyIdx >= 0 ? history[historyIdx] : null;

  function pushHistory(entry) {
    setHistory((prev) => {
      const next = [...prev, entry].slice(-5);
      // snap current index to the newest entry
      setHistoryIdx(next.length - 1);
      return next;
    });
  }

  async function runGeneration() {
    if (busy || !prompt.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      let result;
      if (kind === 'tile-art') {
        const composedPrompt = usePreset ? `${prompt.trim()}. ${STYLE_PRESET}` : prompt.trim();
        result = await pulpAi.generateTileArt(projectId, {
          prompt: composedPrompt,
          model,
          style: usePreset ? '1bit-playdate' : undefined
        });
        // decode immediately so the result panel can render the bit grid
        try {
          result.pixels = await decodeImageToPixels(result.image_base64);
        } catch (e) {
          // keep image so user can still see/accept raw base64; downstream onAccept can re-try
          result.decode_error = e.message || 'decode failed';
        }
      } else if (kind === 'script') {
        result = await pulpAi.generateScript(projectId, {
          prompt: prompt.trim(),
          context: {
            tile_id: context.tile_id,
            room_id: context.room_id,
            scope: context.scope || 'game'
          }
        });
      } else if (kind === 'room-layout') {
        result = await pulpAi.generateRoomLayout(projectId, {
          prompt: prompt.trim(),
          available_tile_ids: Array.from(pendingTileIds)
        });
      } else if (kind === 'sound') {
        result = await pulpAi.generateSound(projectId, { prompt: prompt.trim() });
      } else {
        throw new Error(`unknown kind: ${kind}`);
      }
      pushHistory({ prompt, model, ts: Date.now(), result });
    } catch (e) {
      const d = e.detail;
      const msg = (Array.isArray(d?.detail) ? d.detail.join('; ') : d?.error) || e.message || 'generation failed';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  function discardCurrent() {
    if (historyIdx < 0) return;
    const drop = historyIdx;
    setHistory((prev) => prev.slice(0, drop).concat(prev.slice(drop + 1)));
    setHistoryIdx((prev) => {
      const newLen = history.length - 1;
      if (newLen <= 0) return -1;
      return Math.max(0, prev - 1);
    });
  }

  function accept() {
    if (!current) return;
    onAccept?.(current.result);
    onClose?.();
  }

  function onOverlayClick() {
    // never close while a generation is in flight
    if (busy) return;
    onClose?.();
  }

  return (
    <div className="fixed inset-0 z-30 bg-ink-900/80 flex items-center justify-center p-4" onClick={onOverlayClick}>
      <div
        className="w-full max-w-2xl bg-ink-800 border border-ink-600 rounded-lg p-5 space-y-4 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-base text-ink-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            {TITLES[kind] || 'ai assist'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-ink-400 hover:text-ink-200 disabled:opacity-40"
            aria-label="close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ----- prompt body ----- */}
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-ink-500">prompt</span>
            <textarea
              ref={promptRef}
              className="input font-mono text-xs"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={placeholderFor(kind)}
            />
          </label>

          {kind === 'tile-art' ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="block text-[10px] uppercase tracking-wide text-ink-500">model</span>
                <select
                  className="input text-xs font-mono"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="flex items-end gap-2 text-xs text-ink-200 pb-2">
                <input
                  type="checkbox"
                  checked={usePreset}
                  onChange={(e) => setUsePreset(e.target.checked)}
                />
                <span>1-bit playdate style preset</span>
              </label>
            </div>
          ) : null}

          {kind === 'room-layout' ? (
            <TilePicker
              tiles={context.tilesById || {}}
              available={context.available_tile_ids || []}
              selected={pendingTileIds}
              onChange={setPendingTileIds}
            />
          ) : null}

          <div className="flex items-center gap-2">
            <button
              className="btn-primary text-xs"
              onClick={runGeneration}
              disabled={busy || !prompt.trim()}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {history.length === 0 ? 'generate' : 'regenerate'}
            </button>
            {history.length > 1 ? (
              <HistoryStepper
                count={history.length}
                idx={historyIdx}
                onPick={setHistoryIdx}
                disabled={busy}
              />
            ) : null}
            {err ? <span className="text-xs text-red-400 ml-2 truncate">{err}</span> : null}
          </div>
        </div>

        {/* ----- result panel ----- */}
        {current ? (
          <div className="border-t border-ink-700 pt-4 space-y-3">
            <ResultPanel kind={kind} entry={current} context={context} />
            <div className="flex items-center justify-end gap-2">
              <button className="btn text-xs text-red-400 border-red-900/60" onClick={discardCurrent} disabled={busy}>
                <Trash2 className="w-3.5 h-3.5" /> discard
              </button>
              <button className="btn text-xs" onClick={runGeneration} disabled={busy}>
                <Undo2 className="w-3.5 h-3.5" /> regenerate
              </button>
              <button className="btn-primary text-xs" onClick={accept} disabled={busy}>
                <Check className="w-3.5 h-3.5" /> accept
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function placeholderFor(kind) {
  switch (kind) {
    case 'tile-art': return 'a smiling pumpkin sprite, facing the camera';
    case 'script': return 'when the player bumps this tile, say "ouch" and play sfx_thud';
    case 'room-layout': return 'an outdoor forest clearing with a path through the middle';
    case 'sound': return 'a short coin pickup blip';
    default: return '';
  }
}

// ---------- result subviews ----------

function ResultPanel({ kind, entry, context }) {
  const { result } = entry;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-ink-500">
        <span>result</span>
        {result?.model ? <span className="text-ink-400 font-mono normal-case">· {result.model}</span> : null}
        {typeof result?.cost === 'number' ? (
          <span className="text-ink-400 font-mono normal-case">· ${result.cost.toFixed(4)}</span>
        ) : null}
      </div>

      {kind === 'tile-art' ? <TileArtResult result={result} /> : null}
      {kind === 'script' ? <ScriptResult result={result} /> : null}
      {kind === 'room-layout' ? <RoomLayoutResult result={result} context={context} /> : null}
      {kind === 'sound' ? <SoundResult result={result} /> : null}
    </div>
  );
}

function TileArtResult({ result }) {
  // scale up 12x → 192px, image-rendering: pixelated
  const src = result?.image_base64
    ? (result.image_base64.startsWith('data:') ? result.image_base64 : `data:image/png;base64,${result.image_base64}`)
    : null;
  return (
    <div className="flex items-start gap-4">
      <div className="bg-ink-900 border border-ink-700 p-2 rounded">
        {src ? (
          <img
            src={src}
            alt="generated tile"
            width={192}
            height={192}
            style={{ imageRendering: 'pixelated', width: 192, height: 192 }}
          />
        ) : (
          <div className="w-48 h-48 grid place-items-center text-ink-500 text-xs">no image</div>
        )}
      </div>
      <div className="flex-1 text-xs text-ink-300 space-y-1">
        <div className="text-ink-400">16x16 1-bit, scaled 12x</div>
        {result?.decode_error ? (
          <div className="text-amber-400">decode warning: {result.decode_error}</div>
        ) : null}
        {result?.prompt ? (
          <div className="text-ink-500 text-[11px] font-mono whitespace-pre-wrap">{result.prompt}</div>
        ) : null}
      </div>
    </div>
  );
}

function ScriptResult({ result }) {
  return (
    <div className="space-y-2">
      <pre className="bg-ink-900 border border-ink-700 rounded p-3 text-xs font-mono text-ink-100 max-h-64 overflow-auto whitespace-pre-wrap">
        {result?.script || '-- (empty) --'}
      </pre>
      {result?.explanation ? (
        <p className="text-xs text-ink-300 italic">{result.explanation}</p>
      ) : null}
    </div>
  );
}

function RoomLayoutResult({ result, context }) {
  const grid = result?.grid;
  const tilesById = context.tilesById || {};
  const cellPx = 12; // 12x12 css per cell → 300px wide
  // pre-rasterize tile thumbs (memoize once per result via key)
  const thumbsRef = useRef({});
  const thumbs = thumbsRef.current;
  function thumbSrc(tid) {
    if (!tid) return null;
    if (thumbs[tid]) return thumbs[tid];
    const t = tilesById[tid];
    if (!t || !t.frames?.[0]?.pixels) return null;
    const c = rasterizeFrame(t.frames[0].pixels, 1);
    const url = c.toDataURL();
    thumbs[tid] = url;
    return url;
  }
  if (!Array.isArray(grid) || !grid.length) {
    return <div className="text-xs text-ink-500">no grid returned</div>;
  }
  return (
    <div className="space-y-2">
      <div
        className="inline-grid bg-ink-900 border border-ink-700 p-1 rounded"
        style={{ gridTemplateColumns: `repeat(${grid[0].length}, ${cellPx}px)` }}
      >
        {grid.flatMap((row, ry) =>
          row.map((tid, rx) => {
            const src = thumbSrc(tid);
            return (
              <div
                key={`${ry}-${rx}`}
                title={tid || ''}
                style={{ width: cellPx, height: cellPx, imageRendering: 'pixelated' }}
                className="border border-ink-800"
              >
                {src ? <img src={src} width={cellPx} height={cellPx} style={{ imageRendering: 'pixelated' }} alt="" /> : null}
              </div>
            );
          })
        )}
      </div>
      {result?.explanation ? (
        <p className="text-xs text-ink-300 italic">{result.explanation}</p>
      ) : null}
    </div>
  );
}

function SoundResult({ result }) {
  if (!result) return null;
  const env = result.envelope || {};
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-xs font-mono text-ink-200">
        <Pair k="waveform" v={result.waveform} />
        <Pair k="duration" v={`${result.duration_ms} ms`} />
        <Pair k="freq" v={`${result.freq_start}→${result.freq_end} Hz`} />
        <Pair k="attack" v={`${env.attack} ms`} />
        <Pair k="decay" v={`${env.decay} ms`} />
        <Pair k="sustain" v={`${env.sustain}`} />
        <Pair k="release" v={`${env.release} ms`} />
      </div>
      {result.explanation ? <p className="text-xs text-ink-300 italic">{result.explanation}</p> : null}
      <button className="btn-primary text-xs" onClick={() => previewSound(result)}>
        <Play className="w-3.5 h-3.5" /> preview
      </button>
    </div>
  );
}

function Pair({ k, v }) {
  return (
    <div className="bg-ink-900 border border-ink-700 rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{k}</div>
      <div className="text-ink-100 truncate">{v ?? '—'}</div>
    </div>
  );
}

// ---------- helpers ----------

function TilePicker({ tiles, available, selected, onChange }) {
  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="block text-[10px] uppercase tracking-wide text-ink-500">available tiles</span>
        <div className="flex gap-2 text-[10px]">
          <button className="text-ink-400 hover:text-ink-200" onClick={() => onChange(new Set(available))}>all</button>
          <button className="text-ink-400 hover:text-ink-200" onClick={() => onChange(new Set())}>none</button>
        </div>
      </div>
      <div className="max-h-32 overflow-y-auto border border-ink-700 rounded p-2 grid grid-cols-2 gap-1 bg-ink-900/40">
        {available.length === 0 ? (
          <div className="text-xs text-ink-500 col-span-2">no tiles in project</div>
        ) : available.map((id) => {
          const t = tiles[id];
          return (
            <label key={id} className="flex items-center gap-2 text-xs text-ink-200 font-mono">
              <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
              <span className="truncate">{t?.name || id}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function HistoryStepper({ count, idx, onPick, disabled }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-ink-400">
      <span className="uppercase tracking-wide">history</span>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          disabled={disabled}
          onClick={() => onPick(i)}
          className={`w-5 h-5 rounded border text-[10px] font-mono ${i === idx ? 'border-accent text-accent' : 'border-ink-600 text-ink-300 hover:border-ink-400'}`}
        >{i + 1}</button>
      ))}
    </div>
  );
}
