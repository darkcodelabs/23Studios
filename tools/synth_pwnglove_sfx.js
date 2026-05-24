'use strict';

// One-off bespoke SFX synth for HAKCD PWNGLOVE MODE Tier 1.
// Uses sfx_synth.js _internals (writeWav, envelope, squareWave, noise).
// Writes 12 wavs to source/sounds/sfx/ of personal/hakcd.

const path = require('path');
const sfx = require('/home/hakcer/projects/23studios/server/services/sfx_synth.js');
const { writeWav, envelope, squareWave, noise } = sfx._internals;
const SR = sfx.SAMPLE_RATE; // 22050

const OUT = '/home/hakcer/projects/personal/hakcd/source/sounds/sfx';

function lin(n, from, to) {
  const a = new Float32Array(n);
  const step = (to - from) / (n - 1 || 1);
  for (let i = 0; i < n; i++) a[i] = from + step * i;
  return a;
}
function exp(n, k) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.exp(-(i / (n - 1)) * k);
  return a;
}
function mul(a, b) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] * b[i];
  return o;
}
function mix(...arrs) {
  const n = Math.max(...arrs.map((a) => a.length));
  const o = new Float32Array(n);
  for (const a of arrs) for (let i = 0; i < a.length; i++) o[i] += a[i];
  for (let i = 0; i < n; i++) o[i] /= arrs.length;
  return o;
}
function scale(a, s) {
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] * s;
  return o;
}
function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const o = new Float32Array(total);
  let off = 0;
  for (const a of arrs) { o.set(a, off); off += a.length; }
  return o;
}

// Sine wave from per-sample frequency
function sine(freqs) {
  const n = freqs.length;
  const o = new Float32Array(n);
  let phase = 0;
  const dt = 1 / SR;
  for (let i = 0; i < n; i++) {
    phase += freqs[i] * dt;
    o[i] = Math.sin(2 * Math.PI * phase);
  }
  return o;
}

// One-pole low-pass — soften noise to "rasp" character
function lowpass(a, alpha) {
  const o = new Float32Array(a.length);
  let prev = 0;
  for (let i = 0; i < a.length; i++) {
    prev = prev + alpha * (a[i] - prev);
    o[i] = prev;
  }
  return o;
}

// =========================================================================
// 1. lockpick_crank_turn — low metallic rasp loop
// 200ms, 80-120 Hz square + filtered noise, gentle env so it loops cleanly
function lockpick_crank_turn() {
  const dur = 0.2;
  const n = Math.floor(SR * dur);
  const freqs = lin(n, 95, 110);
  const sq = squareWave(freqs);
  const nz = lowpass(noise(n), 0.06);
  const m = mix(scale(sq, 0.45), scale(nz, 0.55));
  const env = envelope(n, 0.1, 0.1);
  return mul(m, env);
}

// 2. lockpick_pin_click — sharp brass click
// 30ms, noise burst with very fast expDecay
function lockpick_pin_click() {
  const dur = 0.04;
  const n = Math.floor(SR * dur);
  const nz = noise(n);
  const env = exp(n, 14);
  return scale(mul(nz, env), 0.85);
}

// 3. lockpick_tension_warn — rising whine
// 400ms, square sweep 250 → 1100 Hz
function lockpick_tension_warn() {
  const dur = 0.4;
  const n = Math.floor(SR * dur);
  const freqs = lin(n, 250, 1100);
  const sq = squareWave(freqs);
  const env = envelope(n, 0.05, 0.15);
  return scale(mul(sq, env), 0.7);
}

// 4. lockpick_open — clunk + brass tumble
// 500ms total: 80ms low thud + 420ms ascending arpeggio
function lockpick_open() {
  const thud_n = Math.floor(SR * 0.08);
  const thud = scale(mul(squareWave(lin(thud_n, 110, 60)), exp(thud_n, 5)), 0.85);
  const tumble_n = Math.floor(SR * 0.42);
  const arp_freqs = [440, 554, 659, 880];
  const seg_n = Math.floor(tumble_n / arp_freqs.length);
  let tumble = new Float32Array(0);
  for (const f of arp_freqs) {
    const s = scale(mul(squareWave(lin(seg_n, f, f * 1.02)), exp(seg_n, 6)), 0.7);
    tumble = concat(tumble, s);
  }
  return concat(thud, tumble);
}

// 5. lockpick_fail (snap) — harsh buzz
// 250ms, square 200Hz with heavy noise overlay
function lockpick_fail() {
  const dur = 0.25;
  const n = Math.floor(SR * dur);
  const sq = squareWave(lin(n, 200, 160));
  const nz = noise(n);
  const m = mix(scale(sq, 0.6), scale(nz, 0.4));
  const env = envelope(n, 0.02, 0.3);
  return scale(mul(m, env), 0.9);
}

// 6. konami_step — digit commit click + brief tone
function konami_step() {
  const click_n = Math.floor(SR * 0.025);
  const click = scale(mul(noise(click_n), exp(click_n, 16)), 0.7);
  const tone_n = Math.floor(SR * 0.055);
  const tone = scale(mul(squareWave(lin(tone_n, 850, 850)), envelope(tone_n, 0.02, 0.5)), 0.5);
  return concat(click, tone);
}

// 7. konami_unlock — Punch-Out WINNER homage: 4-tone ascending major arpeggio
// C5(523) E5(659) G5(784) C6(1047), each ~120ms, then sustained C6 200ms
function konami_unlock() {
  const note_n = Math.floor(SR * 0.12);
  const seq = [523, 659, 784, 1047];
  let out = new Float32Array(0);
  for (const f of seq) {
    const s = scale(mul(squareWave(lin(note_n, f, f)), envelope(note_n, 0.03, 0.25)), 0.6);
    out = concat(out, s);
  }
  const sus_n = Math.floor(SR * 0.2);
  // Sustained chord C6 + E6 + G6 (triad)
  const c = squareWave(lin(sus_n, 1047, 1047));
  const e = squareWave(lin(sus_n, 1319, 1319));
  const g = squareWave(lin(sus_n, 1568, 1568));
  const chord = mix(c, e, g);
  out = concat(out, scale(mul(chord, envelope(sus_n, 0.02, 0.6)), 0.7));
  return out;
}

// 8. vault_hum (loopable) — low drone, 600ms, 60 Hz + 80 Hz mix with slight tremolo
function vault_hum() {
  const dur = 0.6;
  const n = Math.floor(SR * dur);
  const s60 = sine(lin(n, 60, 60));
  const s80 = sine(lin(n, 80, 80));
  // tremolo at 6Hz
  const trem = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    trem[i] = 0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t);
  }
  const m = mix(scale(s60, 0.6), scale(s80, 0.4));
  // gentle env so loop seam isn't a click
  const env = envelope(n, 0.05, 0.05);
  return scale(mul(mul(m, trem), env), 0.7);
}

// 9. vault_door_open — heavy click + rising servo whirr
function vault_door_open() {
  const click_n = Math.floor(SR * 0.06);
  const click = scale(mul(squareWave(lin(click_n, 80, 50)), exp(click_n, 5)), 0.9);
  const whirr_n = Math.floor(SR * 0.34);
  const whirr = scale(mul(squareWave(lin(whirr_n, 180, 320)), envelope(whirr_n, 0.05, 0.2)), 0.5);
  return concat(click, whirr);
}

// 10. coin_navigate_tick — soft tick
function coin_navigate_tick() {
  const n = Math.floor(SR * 0.022);
  const nz = noise(n);
  const env = exp(n, 18);
  return scale(mul(nz, env), 0.55);
}

// 11. coin_zoom_whoosh — short bandpass-style noise whoosh
function coin_zoom_whoosh() {
  const dur = 0.22;
  const n = Math.floor(SR * dur);
  const nz = noise(n);
  // simulate band-pass: low-pass then subtract very-low (single-pole highpass)
  const lp = lowpass(nz, 0.18);
  const lp2 = lowpass(lp, 0.03);
  const band = new Float32Array(n);
  for (let i = 0; i < n; i++) band[i] = lp[i] - lp2[i];
  // sweep envelope ramp-up then drop
  const env = envelope(n, 0.5, 0.4);
  return scale(mul(band, env), 0.8);
}

// 12. pwnglove_boot — synth chord, 500ms, C major triad with slight rise
function pwnglove_boot() {
  const dur = 0.5;
  const n = Math.floor(SR * dur);
  const c = squareWave(lin(n, 261, 280));
  const e = squareWave(lin(n, 329, 352));
  const g = squareWave(lin(n, 392, 420));
  const chord = mix(c, e, g);
  const env = envelope(n, 0.05, 0.4);
  return scale(mul(chord, env), 0.75);
}

// =========================================================================

const sounds = {
  'lockpick_crank_turn.wav':    lockpick_crank_turn(),
  'lockpick_pin_click.wav':     lockpick_pin_click(),
  'lockpick_tension_warn.wav':  lockpick_tension_warn(),
  'lockpick_open.wav':          lockpick_open(),
  'lockpick_fail.wav':          lockpick_fail(),
  'konami_step.wav':            konami_step(),
  'konami_unlock.wav':          konami_unlock(),
  'vault_hum.wav':              vault_hum(),
  'vault_door_open.wav':        vault_door_open(),
  'vault_door_close.wav':       vault_door_open(),  // reverse of open — reuse for now
  'coin_navigate_tick.wav':     coin_navigate_tick(),
  'coin_zoom_whoosh.wav':       coin_zoom_whoosh(),
  'pwnglove_boot.wav':          pwnglove_boot(),
};

for (const [name, samples] of Object.entries(sounds)) {
  const dest = path.join(OUT, name);
  writeWav(dest, samples);
  const dur_ms = Math.round((samples.length / SR) * 1000);
  console.log(`${name.padEnd(30)} ${dur_ms.toString().padStart(4)}ms`);
}

console.log(`\nGenerated ${Object.keys(sounds).length} bespoke SFX.`);
