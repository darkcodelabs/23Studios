'use strict';

// dialogue_corpus.js — voice-anchor sampler for dialogue_generator.
//
// Loads a corpus of period-accurate hacker / phreaker voice samples (SecKC
// meetup transcripts + a hand-written anchor) and exposes a sampler that
// returns N random ~200-word excerpts on demand. Used as system-prompt
// calibration so generated NPC dialogue reads like real community voice
// instead of generic AI tone.

const fs = require('fs');
const path = require('path');

const CORPUS_ROOT = path.join(__dirname, 'dialogue_corpus');
const SECKC_DIR = path.join(CORPUS_ROOT, 'seckc');
const ANCHOR_PATH = path.join(CORPUS_ROOT, 'anchor.md');

const WORDS_PER_EXCERPT = 200;
const MIN_EXCERPT_WORDS = 60;

let _cached = null;

function listCorpusFiles() {
  const out = [];
  try {
    for (const f of fs.readdirSync(SECKC_DIR)) {
      if (/\.(txt|md)$/i.test(f)) out.push({ source: 'seckc', path: path.join(SECKC_DIR, f) });
    }
  } catch (_e) { /* dir missing — anchor only */ }
  if (fs.existsSync(ANCHOR_PATH)) out.push({ source: 'anchor', path: ANCHOR_PATH });
  return out;
}

function load() {
  if (_cached) return _cached;
  const files = listCorpusFiles();
  const passages = [];
  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(f.path, 'utf8'); }
    catch (_e) { continue; }
    // Split on blank-line paragraphs; keep paragraphs that have enough words.
    const paragraphs = raw.split(/\n\s*\n/);
    for (const p of paragraphs) {
      const clean = p.replace(/\s+/g, ' ').trim();
      const wc = clean.split(/\s+/).length;
      if (wc >= MIN_EXCERPT_WORDS) {
        passages.push({ source: f.source, file: path.basename(f.path), text: clean });
      }
    }
  }
  _cached = { passages, files: files.length };
  return _cached;
}

function trimToWords(text, n) {
  const words = text.split(/\s+/);
  if (words.length <= n) return text;
  return words.slice(0, n).join(' ') + '...';
}

// Return N random ~200-word excerpts. Deterministic when seed provided so
// the same (scene, npc) gets the same excerpts across regen calls.
function sample(n = 3, seed = null) {
  const { passages } = load();
  if (passages.length === 0) return [];
  // Simple deterministic RNG if seeded — Mulberry32 keyed off seed string
  let rng;
  if (seed != null) {
    let h = 0;
    for (let i = 0; i < String(seed).length; i++) {
      h = (h * 31 + String(seed).charCodeAt(i)) | 0;
    }
    rng = (function (s) {
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(h);
  } else {
    rng = Math.random;
  }
  const pickedIdx = new Set();
  const out = [];
  let tries = 0;
  while (out.length < n && pickedIdx.size < passages.length && tries < n * 10) {
    tries++;
    const i = Math.floor(rng() * passages.length);
    if (pickedIdx.has(i)) continue;
    pickedIdx.add(i);
    out.push({
      source: passages[i].source,
      file: passages[i].file,
      text: trimToWords(passages[i].text, WORDS_PER_EXCERPT)
    });
  }
  return out;
}

function stats() {
  const { passages, files } = load();
  return { files, passages: passages.length };
}

module.exports = { sample, stats, listCorpusFiles };
