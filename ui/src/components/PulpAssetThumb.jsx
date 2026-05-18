import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2, Music, Image as ImageIcon, Play, AudioWaveform
} from 'lucide-react';
import { rasterizeFrame } from '../lib/pulp_api.js';
import { sceneUrl } from '../lib/pulp_scenes.js';

// Cache rasterized tile canvases keyed by pixels string + size + colors.
// rasterizeFrame already builds an offscreen canvas, but we memoize the
// resulting data URL so re-renders of the gallery don't reburn pixels.
const RASTER_CACHE = new Map();
const RASTER_CACHE_MAX = 512;

function cachedTileDataUrl(pixels, size, on, off) {
  const key = `${pixels}|${size}|${on}|${off}`;
  if (RASTER_CACHE.has(key)) return RASTER_CACHE.get(key);
  const scale = Math.max(1, Math.floor(size / 16));
  const c = rasterizeFrame(pixels, scale, on, off);
  let url = '';
  try { url = c.toDataURL('image/png'); } catch (_e) { url = ''; }
  if (RASTER_CACHE.size > RASTER_CACHE_MAX) {
    // drop oldest insert (Map preserves insertion order)
    const firstKey = RASTER_CACHE.keys().next().value;
    if (firstKey !== undefined) RASTER_CACHE.delete(firstKey);
  }
  RASTER_CACHE.set(key, url);
  return url;
}

// One WebAudio context shared across thumbs, lazily created.
let _ac = null;
function audioCtx() {
  if (typeof window === 'undefined') return null;
  if (_ac && _ac.state !== 'closed') return _ac;
  _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

// Re-implementation of the SFX preview helper (private to PulpSounds.jsx).
// Mirrors the same envelope semantics so the thumb sounds identical.
function previewSound(spec) {
  const ctx = audioCtx();
  if (!ctx || !spec) return;
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
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    gain.gain.linearRampToValueAtTime(1, now + a);
    gain.gain.linearRampToValueAtTime(s, now + a + d);
    gain.gain.setValueAtTime(s, now + Math.max(a + d, dur - r));
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
  gain.gain.setValueAtTime(s, now + Math.max(a + d, dur - r));
  gain.gain.linearRampToValueAtTime(0, now + dur);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

// Best-effort song preview: grab the first non-empty note across tracks and
// play it as a short sine tone. The piano-roll editor lands later; this is
// purely so the thumb does *something* audible.
function previewSong(song) {
  const ctx = audioCtx();
  if (!ctx || !song) return;
  if (ctx.state === 'suspended') ctx.resume();
  // Track shape is intentionally loose — accept numbers, {note}, {freq}.
  let freq = null;
  const tracks = Array.isArray(song.tracks) ? song.tracks : [];
  outer: for (const t of tracks) {
    if (!Array.isArray(t)) continue;
    for (const step of t) {
      if (step == null) continue;
      if (typeof step === 'number' && step > 0) { freq = midiToFreq(step); break outer; }
      if (typeof step === 'object') {
        if (typeof step.freq === 'number') { freq = step.freq; break outer; }
        if (typeof step.note === 'number') { freq = midiToFreq(step.note); break outer; }
      }
    }
  }
  if (!freq) freq = 440;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, now);
  osc.connect(gain);
  gain.gain.linearRampToValueAtTime(0.4, now + 0.01);
  gain.gain.linearRampToValueAtTime(0, now + 0.35);
  osc.start(now);
  osc.stop(now + 0.4);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------- main component ----------

export default function PulpAssetThumb({
  kind,
  projectId,
  asset,
  size = 64,
  onClick,
  cacheBust
}) {
  if (!asset) return null;
  const label = (asset.name || asset.id || '').toString();
  const subtitle = useMemo(() => describe(kind, asset), [kind, asset]);
  return (
    <button
      type="button"
      onClick={() => onClick?.(kind, asset)}
      title={`${label}\n${subtitle}`}
      className="group flex flex-col items-stretch gap-1 bg-ink-900/60 border border-ink-700 hover:border-accent/70 rounded p-1 text-left transition"
      style={{ width: size + 8 }}
    >
      <div
        className="relative bg-ink-950 rounded overflow-hidden flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {kind === 'tile' ? (
          <TilePreview asset={asset} size={size} />
        ) : kind === 'scene' ? (
          <ScenePreview asset={asset} size={size} projectId={projectId} cacheBust={cacheBust} />
        ) : kind === 'sound' ? (
          <SoundPreview asset={asset} size={size} />
        ) : kind === 'song' ? (
          <SongPreview asset={asset} size={size} />
        ) : null}
      </div>
      <div
        className="font-mono text-[10px] text-ink-300 truncate"
        style={{ width: size }}
      >
        {label || '(unnamed)'}
      </div>
    </button>
  );
}

function describe(kind, a) {
  if (kind === 'tile') return `${a.type || 'tile'} · ${a.frames?.length || 0} frame(s)`;
  if (kind === 'scene') return `room · ${a.id || ''}`;
  if (kind === 'sound') return `${a.waveform || 'sine'} · ${a.duration_ms || 0}ms`;
  if (kind === 'song') return `bpm ${a.bpm || 120}`;
  return '';
}

// ---------- per-kind renderers ----------

function TilePreview({ asset, size }) {
  const pixels = asset.frames?.[0]?.pixels || '0'.repeat(256);
  const url = useMemo(
    () => cachedTileDataUrl(pixels, size, '#9dffce', '#0d1117'),
    [pixels, size]
  );
  return (
    <>
      {url ? (
        <img
          src={url}
          alt={asset.name || asset.id || 'tile'}
          loading="lazy"
          width={size}
          height={size}
          style={{ imageRendering: 'pixelated', width: size, height: size }}
        />
      ) : (
        <ImageIcon className="w-4 h-4 text-ink-500" />
      )}
      {asset.type ? (
        <span className="absolute bottom-0 left-0 text-[8px] font-mono px-1 bg-ink-900/80 text-ink-200 rounded-tr">
          {asset.type}
        </span>
      ) : null}
    </>
  );
}

function ScenePreview({ asset, size, projectId, cacheBust }) {
  const [errored, setErrored] = useState(false);
  const url = useMemo(
    () => sceneUrl(projectId, asset.id, cacheBust || asset.updated_at || 'v1'),
    [projectId, asset.id, cacheBust, asset.updated_at]
  );
  if (errored) {
    return (
      <div className="flex flex-col items-center justify-center text-ink-600 text-[9px] font-mono">
        <ImageIcon className="w-4 h-4 mb-0.5" />
        no scene
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={asset.name || asset.id || 'scene'}
      loading="lazy"
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className="object-cover w-full h-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function SoundPreview({ asset, size }) {
  function onPlay(e) {
    e.stopPropagation();
    try { previewSound(asset); } catch (_e) { /* ignore */ }
  }
  return (
    <div
      className="relative flex flex-col items-center justify-center text-ink-300 w-full h-full cursor-pointer"
      onClick={onPlay}
      role="button"
      tabIndex={-1}
    >
      <Volume2 className="w-4 h-4 mb-0.5 text-accent" />
      <AudioWaveform className="w-5 h-3 text-ink-500" />
      <span className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition bg-ink-900/80 text-accent rounded-bl p-0.5">
        <Play className="w-3 h-3" />
      </span>
    </div>
  );
}

function SongPreview({ asset, size }) {
  function onPlay(e) {
    e.stopPropagation();
    try { previewSong(asset); } catch (_e) { /* ignore */ }
  }
  return (
    <div
      className="relative flex flex-col items-center justify-center text-ink-300 w-full h-full cursor-pointer"
      onClick={onPlay}
      role="button"
      tabIndex={-1}
    >
      <Music className="w-4 h-4 mb-0.5 text-accent" />
      <span className="text-[9px] font-mono text-ink-400">{asset.bpm || 120} bpm</span>
      <span className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition bg-ink-900/80 text-accent rounded-bl p-0.5">
        <Play className="w-3 h-3" />
      </span>
    </div>
  );
}
