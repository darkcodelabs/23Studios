// Web Audio synth for the pulp interpreter.
// Mirrors the previewSound helper in ui/src/pages/PulpSounds.jsx so the
// runtime hears exactly what the editor's preview button plays. Also
// supports very simple song playback (sequence of notes with bpm).

let _ac = null;
function audioCtx() {
  if (typeof window === 'undefined') return null;
  if (_ac && _ac.state !== 'closed') return _ac;
  _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

export function playSfx(spec) {
  if (!spec) return;
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
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    rampEnvelope(gain.gain, now, a, d, s, r, dur);
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
  rampEnvelope(gain.gain, now, a, d, s, r, dur);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

function rampEnvelope(gainParam, now, a, d, s, r, dur) {
  gainParam.linearRampToValueAtTime(1, now + a);
  gainParam.linearRampToValueAtTime(s, now + a + d);
  gainParam.setValueAtTime(s, now + Math.max(a + d, dur - r));
  gainParam.linearRampToValueAtTime(0, now + dur);
}

// ---- Song player (very crude) ----
// Looks up sounds by note name and plays sequentially at bpm rate. Most
// pulp song formats use string note names (C4, etc) which we map to freq.

const NOTE_FREQ = (() => {
  const out = Object.create(null);
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  for (let oct = 0; oct <= 8; oct++) {
    for (let i = 0; i < 12; i++) {
      const f = 440 * Math.pow(2, (oct * 12 + i - 57) / 12);
      out[names[i] + oct] = f;
    }
  }
  return out;
})();

let _songTimer = null;
let _songStep = 0;

export function startSong(song, looped) {
  stopSong();
  if (!song || !song.tracks || !song.tracks[0]) return;
  const bpm = Math.max(20, song.bpm || 120);
  const stepMs = 60000 / bpm;
  const track = song.tracks[0];
  if (!track || track.length === 0) return;
  _songStep = 0;
  const tick = () => {
    if (_songStep >= track.length) {
      if (looped) _songStep = song.loop_from || 0;
      else { stopSong(); return; }
    }
    const note = track[_songStep++];
    if (note && note.note) {
      const freq = NOTE_FREQ[note.note] || 440;
      playSfx({
        waveform: 'square',
        freq_start: freq,
        freq_end: freq,
        duration_ms: Math.max(40, (note.duration || 0.25) * stepMs * 0.9),
        envelope: { attack: 2, decay: 10, sustain: 0.6, release: 30 },
      });
    }
    _songTimer = setTimeout(tick, stepMs);
  };
  tick();
}

export function stopSong() {
  if (_songTimer) clearTimeout(_songTimer);
  _songTimer = null;
}
