'use strict';

// intake_upload.js — Phase 6 A1 (Intake)
//
// Accepts source material for a project and mirrors it under
// <local_path>/sdk_data/source/ with stable layout + SHA256 manifest:
//
//   sdk_data/source/
//     bible.md           (story bible — required for extraction)
//     canon.md           (style/prompt canon)
//     skill.md           (platform constraints — usually SKILL.md)
//     refs/<filename>    (reference images, names sanitized)
//     urls.json          (supplementary URL references with tags)
//     notes.json         (free-form notes/anecdotes with tags)
//     manifest.json      (SHA256 per input + ingest log)
//
// The route layer (routes/projects.js POST /api/projects/:id/intake/sources)
// handles multipart parsing and hands buffers + a manifest spec here.
//
// Re-intake: when the manifest already exists, ingest() diffs old vs new and
// returns { added, changed, removed, unchanged } per item.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const SOURCE_REL = path.join('sdk_data', 'source');
const REFS_REL = path.join(SOURCE_REL, 'refs');
const MANIFEST_REL = path.join(SOURCE_REL, 'manifest.json');
const URLS_REL = path.join(SOURCE_REL, 'urls.json');
const NOTES_REL = path.join(SOURCE_REL, 'notes.json');

const MAX_TEXT_BYTES = 4 * 1024 * 1024;   // 4 MB per text doc
const MAX_IMAGE_BYTES = 16 * 1024 * 1024; // matches raw-asset cap (PR #14)
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SAFE_URL_RE = /^https?:\/\/[^\s<>"']{1,2000}$/i;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeFilename(name) {
  const raw = String(name || '');
  // Reject any path component before basename'ing — callers should not be
  // passing nested paths and we don't want silent flattening of traversal
  // attempts to a "looks safe" leaf name.
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null;
  if (!SAFE_FILENAME_RE.test(raw)) return null;
  return raw;
}

async function ensureDirs(localPath) {
  await fsp.mkdir(path.join(localPath, SOURCE_REL), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(localPath, REFS_REL), { recursive: true, mode: 0o700 });
}

async function readJsonOrDefault(fp, fallback) {
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_e) {
    return fallback;
  }
}

async function writeJsonAtomic(fp, data) {
  const tmp = fp + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, fp);
}

// Read the persisted source manifest if any. Shape:
//   { updated_at, items: { <key>: { kind, rel_path, sha256, bytes, tag?, subject_hint?, url? } } }
async function readManifest(localPath) {
  const fp = path.join(localPath, MANIFEST_REL);
  return readJsonOrDefault(fp, { updated_at: null, items: {} });
}

async function writeManifest(localPath, manifest) {
  const fp = path.join(localPath, MANIFEST_REL);
  await writeJsonAtomic(fp, manifest);
  return fp;
}

// ---- text doc ingestion (bible / canon / skill) ----

async function writeTextDoc(localPath, name, contentBuf) {
  if (!Buffer.isBuffer(contentBuf)) {
    contentBuf = Buffer.from(String(contentBuf == null ? '' : contentBuf), 'utf8');
  }
  if (contentBuf.length === 0) return null;
  if (contentBuf.length > MAX_TEXT_BYTES) {
    const err = new Error(`text doc ${name} exceeds ${MAX_TEXT_BYTES} bytes`);
    err.status = 413;
    err.code = 'file_too_large';
    throw err;
  }
  const rel = path.join(SOURCE_REL, name);
  const abs = path.join(localPath, rel);
  await fsp.writeFile(abs, contentBuf, { mode: 0o600 });
  return { rel_path: rel, sha256: sha256(contentBuf), bytes: contentBuf.length };
}

// ---- reference image ingestion ----

async function writeReferenceImage(localPath, originalName, contentBuf) {
  if (!Buffer.isBuffer(contentBuf)) {
    const err = new Error('reference image must be a Buffer');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  if (contentBuf.length === 0) return null;
  if (contentBuf.length > MAX_IMAGE_BYTES) {
    const err = new Error(`reference image ${originalName} exceeds ${MAX_IMAGE_BYTES} bytes`);
    err.status = 413;
    err.code = 'file_too_large';
    throw err;
  }
  const safe = safeFilename(originalName);
  if (!safe) {
    const err = new Error(`reference image filename ${originalName} not safe`);
    err.status = 400;
    err.code = 'bad_filename';
    throw err;
  }
  const rel = path.join(REFS_REL, safe);
  const abs = path.join(localPath, rel);
  await fsp.writeFile(abs, contentBuf, { mode: 0o600 });
  return { rel_path: rel, sha256: sha256(contentBuf), bytes: contentBuf.length, filename: safe };
}

// ---- URL + notes lists ----

function normalizeUrlEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const url = typeof entry.url === 'string' ? entry.url.trim() : '';
  if (!SAFE_URL_RE.test(url)) return null;
  return {
    url,
    tag: typeof entry.tag === 'string' ? entry.tag.slice(0, 64) : '',
    subject_hint: typeof entry.subject_hint === 'string' ? entry.subject_hint.slice(0, 256) : '',
    added_at: entry.added_at || new Date().toISOString()
  };
}

function normalizeNoteEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  if (!text) return null;
  if (text.length > 32 * 1024) return null;
  return {
    text,
    tag: typeof entry.tag === 'string' ? entry.tag.slice(0, 64) : '',
    added_at: entry.added_at || new Date().toISOString()
  };
}

async function writeUrls(localPath, urls) {
  const cleaned = (urls || []).map(normalizeUrlEntry).filter(Boolean);
  await writeJsonAtomic(path.join(localPath, URLS_REL), { urls: cleaned });
  return cleaned;
}

async function writeNotes(localPath, notes) {
  const cleaned = (notes || []).map(normalizeNoteEntry).filter(Boolean);
  await writeJsonAtomic(path.join(localPath, NOTES_REL), { notes: cleaned });
  return cleaned;
}

// Compute diff between previous + next manifest item maps.
// added   = key in next, not in prev
// changed = key in both, sha256 differs
// removed = key in prev, not in next
// unchanged = key in both, sha256 same
function diffManifests(prevItems, nextItems) {
  const added = [];
  const changed = [];
  const removed = [];
  const unchanged = [];
  const prevKeys = Object.keys(prevItems || {});
  const nextKeys = Object.keys(nextItems || {});
  const nextSet = new Set(nextKeys);
  const prevSet = new Set(prevKeys);
  for (const k of nextKeys) {
    if (!prevSet.has(k)) { added.push(k); continue; }
    const a = prevItems[k];
    const b = nextItems[k];
    if (a && b && a.sha256 === b.sha256) unchanged.push(k);
    else changed.push(k);
  }
  for (const k of prevKeys) {
    if (!nextSet.has(k)) removed.push(k);
  }
  return { added, changed, removed, unchanged };
}

// Spec shape (handed from the route after multipart parsing):
//   {
//     bible?:        { content: Buffer | string }                        // -> bible.md
//     canon?:        { content: Buffer | string }                        // -> canon.md
//     skill_md?:     { content: Buffer | string }                        // -> skill.md
//     reference_images?: Array<{ filename: string, content: Buffer }>    // -> refs/<name>
//     urls?:         Array<{ url, tag?, subject_hint? }>                 // -> urls.json
//     notes?:        Array<{ text, tag? }>                               // -> notes.json
//   }
//
// Returns { manifest, diff, written } where:
//   manifest = the new manifest persisted to disk
//   diff     = { added, changed, removed, unchanged }   (vs previous manifest)
//   written  = { bible, canon, skill_md, reference_images: [...], urls: N, notes: N }
async function ingest(localPath, spec) {
  if (!localPath || typeof localPath !== 'string') {
    const err = new Error('localPath required');
    err.status = 400; err.code = 'bad_request';
    throw err;
  }
  if (!fs.existsSync(localPath)) {
    const err = new Error('localPath does not exist');
    err.status = 404; err.code = 'not_found';
    throw err;
  }
  await ensureDirs(localPath);

  const prev = await readManifest(localPath);
  const prevItems = prev.items || {};

  // Preserve carried-over items unless the new spec replaces them.
  const nextItems = { ...prevItems };
  const written = { reference_images: [], urls: 0, notes: 0 };

  // Text docs — fixed keys.
  const textDocs = [
    ['bible', 'bible.md'],
    ['canon', 'canon.md'],
    ['skill_md', 'skill.md']
  ];
  for (const [field, filename] of textDocs) {
    const entry = spec && spec[field];
    if (!entry) continue;
    const buf = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content == null ? '' : entry.content), 'utf8');
    const meta = await writeTextDoc(localPath, filename, buf);
    if (!meta) continue;
    nextItems[field] = {
      kind: field,
      rel_path: meta.rel_path,
      sha256: meta.sha256,
      bytes: meta.bytes,
      updated_at: new Date().toISOString()
    };
    written[field] = meta;
  }

  // Reference images — keyed by safe filename.
  if (Array.isArray(spec && spec.reference_images)) {
    // If caller is doing a "replace all" upload, optionally clear stale refs.
    // For v1 we keep existing refs by default; caller hits a delete endpoint
    // to drop one. (Re-uploading the same name overwrites + bumps sha256.)
    for (const img of spec.reference_images) {
      if (!img) continue;
      const meta = await writeReferenceImage(localPath, img.filename, img.content);
      if (!meta) continue;
      const key = `ref:${meta.filename}`;
      nextItems[key] = {
        kind: 'reference_image',
        rel_path: meta.rel_path,
        filename: meta.filename,
        sha256: meta.sha256,
        bytes: meta.bytes,
        tag: typeof img.tag === 'string' ? img.tag.slice(0, 64) : '',
        subject_hint: typeof img.subject_hint === 'string' ? img.subject_hint.slice(0, 256) : '',
        updated_at: new Date().toISOString()
      };
      written.reference_images.push(meta);
    }
  }

  // URLs + notes — stored as full-file replacements, sha256 of the JSON body
  // so the diff surfaces "the URL list changed" as a single line item.
  if (Array.isArray(spec && spec.urls)) {
    const cleaned = await writeUrls(localPath, spec.urls);
    const body = Buffer.from(JSON.stringify({ urls: cleaned }), 'utf8');
    nextItems.urls = {
      kind: 'urls',
      rel_path: URLS_REL,
      sha256: sha256(body),
      bytes: body.length,
      count: cleaned.length,
      updated_at: new Date().toISOString()
    };
    written.urls = cleaned.length;
  }
  if (Array.isArray(spec && spec.notes)) {
    const cleaned = await writeNotes(localPath, spec.notes);
    const body = Buffer.from(JSON.stringify({ notes: cleaned }), 'utf8');
    nextItems.notes = {
      kind: 'notes',
      rel_path: NOTES_REL,
      sha256: sha256(body),
      bytes: body.length,
      count: cleaned.length,
      updated_at: new Date().toISOString()
    };
    written.notes = cleaned.length;
  }

  const diff = diffManifests(prevItems, nextItems);
  const nextManifest = {
    updated_at: new Date().toISOString(),
    items: nextItems
  };
  await writeManifest(localPath, nextManifest);

  return { manifest: nextManifest, diff, written };
}

// List the current source state for the project — used by /sources GET and by
// the extraction service to enumerate inputs without re-parsing multipart.
async function listSources(localPath) {
  await ensureDirs(localPath);
  const manifest = await readManifest(localPath);
  const items = manifest.items || {};
  const urls = await readJsonOrDefault(path.join(localPath, URLS_REL), { urls: [] });
  const notes = await readJsonOrDefault(path.join(localPath, NOTES_REL), { notes: [] });
  return {
    manifest,
    text_docs: {
      bible: items.bible || null,
      canon: items.canon || null,
      skill_md: items.skill_md || null
    },
    reference_images: Object.keys(items)
      .filter((k) => k.startsWith('ref:'))
      .map((k) => items[k])
      .sort((a, b) => (a.filename || '').localeCompare(b.filename || '')),
    urls: urls.urls || [],
    notes: notes.notes || []
  };
}

// Remove a reference image by safe filename. Errors are non-fatal if the file
// is already gone — the manifest update is what matters.
async function removeReferenceImage(localPath, filename) {
  const safe = safeFilename(filename);
  if (!safe) {
    const err = new Error('bad filename'); err.status = 400; err.code = 'bad_filename';
    throw err;
  }
  const manifest = await readManifest(localPath);
  const key = `ref:${safe}`;
  if (!manifest.items || !manifest.items[key]) {
    const err = new Error('not_found'); err.status = 404; err.code = 'not_found';
    throw err;
  }
  const abs = path.join(localPath, REFS_REL, safe);
  try { await fsp.unlink(abs); } catch (_e) { /* already gone */ }
  delete manifest.items[key];
  manifest.updated_at = new Date().toISOString();
  await writeManifest(localPath, manifest);
  return { removed: safe };
}

module.exports = {
  ingest,
  listSources,
  removeReferenceImage,
  readManifest,
  diffManifests,
  // exposed for tests
  _internal: {
    safeFilename,
    sha256,
    SOURCE_REL,
    REFS_REL,
    MAX_TEXT_BYTES,
    MAX_IMAGE_BYTES
  }
};
