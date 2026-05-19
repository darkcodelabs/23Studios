'use strict';

// sdk_release_packager.js — Step 10: Release Packaging
//
// Reads project data from:
//   <sdkRoot>/sdk_data/project.json     — title, description, intake fields
//   <sdkRoot>/source/pdxinfo            — Playdate manifest (name, version, author, bundleID)
//   sdk_export.getJobsByProject(id)     — latest completed .pdx path
//   <sdkRoot>/sdk_data/preview/recording/*.png  — screenshots (may be absent)
//
// Writes under <sdkRoot>/release/<tag>/:
//   README.md
//   CHANGELOG.md
//   LICENSE
//   build.sh
//   <name>-<tag>.pdx.zip
//   screenshots/  (PNGs only, skipped if source dir empty)
//   presskit/
//     description.txt
//     controls.txt
//     credits.txt
//     meta.json
//
// Returns { release_dir, files: [{path, bytes, kind}] }

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const projects = require('./projects');
const sdkExport = require('./sdk_export');

// Parse a pdxinfo key=value file into an object.
function parsePdxinfo(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

// Find the latest completed pdx path for a project (same logic as sdk_preview).
function latestPdxPath(projectId) {
  const jobs = sdkExport.getJobsByProject(projectId);
  const done = jobs
    .filter((j) => j.status === 'done')
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  if (done.length === 0) return null;
  const p = done[0].out_pdx;
  return p && fs.existsSync(p) ? p : null;
}

// Read a file as string, or return null if absent.
function tryRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (_e) { return null; }
}

// Get the current git describe / log entry for CHANGELOG.
// Returns a one-line string or a placeholder.
function gitLogSince(cwd, prevTag) {
  try {
    const args = prevTag
      ? ['log', `${prevTag}..HEAD`, '--oneline', '--no-decorate', '--max-count=30']
      : ['log', '--oneline', '--no-decorate', '--max-count=30'];
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    return null;
  } catch (_e) {
    return null;
  }
}

// Find the most recent prior tag from git, ignoring the current tag.
function prevGitTag(cwd, currentTag) {
  try {
    const r = spawnSync('git', ['tag', '--sort=-creatordate'], { cwd, encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) return null;
    const tags = r.stdout.trim().split(/\n/).filter((t) => t && t !== currentTag);
    return tags[0] || null;
  } catch (_e) {
    return null;
  }
}

// Read the story_bible.md excerpt (first 800 chars) for presskit.
function storyBibleExcerpt(sdkRoot) {
  const p = path.join(sdkRoot, 'sdk_data', 'story_bible.md');
  const raw = tryRead(p);
  if (!raw) return '';
  return raw.slice(0, 800).trimEnd();
}

// Build README.md content.
function buildReadme(opts) {
  const { title, description, controls, sdkVersion, tag, developer, name } = opts;
  const lines = [
    `# ${title}`,
    '',
    description || '',
    '',
    '## Controls',
    '',
    controls || 'See in-game help screen.',
    '',
    '## Installation',
    '',
    '1. Download `' + name + '-' + tag + '.pdx.zip`.',
    '2. Unzip to get `' + name + '.pdx/`.',
    '3. Sideload via the [Playdate Simulator](https://sdk.play.date/3.0.6/) or drag onto a USB-connected device.',
    '',
    '## SDK Version',
    '',
    `Compiled with Playdate SDK ${sdkVersion || '3.0.6'}.`,
    '',
    '## Building from Source',
    '',
    '```sh',
    'bash build.sh',
    '```',
    '',
    '> Requires the [Playdate SDK](https://sdk.play.date/3.0.6/) installed and `pdc` on your PATH.',
    '',
    '## Credits',
    '',
    `Developed by ${developer || 'Unknown'}.`,
    ''
  ];
  return lines.join('\n');
}

// Build CHANGELOG.md content, appending to any existing file.
function buildChangelog(opts) {
  const { tag, buildDate, gitLog, existingChangelog } = opts;
  const header = `## [${tag}] — ${buildDate}`;
  const body = gitLog
    ? gitLog.split('\n').map((l) => '- ' + l.trim()).join('\n')
    : '- Initial release.';
  const newEntry = [header, '', body, ''].join('\n');

  if (existingChangelog) {
    // Append new entry at top, after the H1 title if present.
    const lines = existingChangelog.split('\n');
    const h1Idx = lines.findIndex((l) => l.startsWith('# '));
    if (h1Idx >= 0) {
      lines.splice(h1Idx + 1, 0, '', newEntry.trimEnd());
      return lines.join('\n') + '\n';
    }
    return newEntry + existingChangelog;
  }

  return ['# Changelog', '', '> All notable changes are documented here.', '', newEntry].join('\n');
}

// Build MIT LICENSE content.
function buildLicense(developer, year) {
  return [
    `MIT License`,
    '',
    `Copyright (c) ${year} ${developer || 'Unknown'}`,
    '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
    ''
  ].join('\n');
}

// Build build.sh content.
function buildBuildSh(name, tag) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# build.sh — compile and zip ${name} ${tag}`,
    '# Requires: Playdate SDK with pdc on PATH',
    '',
    `PDC=\${PLAYDATE_SDK_PATH:-\$HOME/Developer/PlaydateSDK}/bin/pdc`,
    `NAME="${name}"`,
    `TAG="${tag}"`,
    '',
    'echo "Compiling $NAME..."',
    '"$PDC" source "$NAME.pdx"',
    '',
    'echo "Zipping..."',
    'zip -r "$NAME-$TAG.pdx.zip" "$NAME.pdx/"',
    '',
    'echo "Done: $NAME-$TAG.pdx.zip"',
    ''
  ].join('\n');
}

// Stat a file and return bytes, or 0 if absent.
function fileBytes(filePath) {
  try { return fs.statSync(filePath).size; } catch (_e) { return 0; }
}

// Core pack function.
async function pack(projectId, opts = {}) {
  const { tag = 'v0.1.0', force = false, include_screenshots = true } = opts;

  const project = await projects.getProject(projectId);
  if (!project) {
    const e = new Error('project not found');
    e.status = 404;
    throw e;
  }
  if (!project.local_path) {
    throw new Error('project has no local_path');
  }

  const sdkRoot = project.local_path;

  // --- Read source data ---

  // 1. sdk_data/project.json
  const sdkDataPath = path.join(sdkRoot, 'sdk_data', 'project.json');
  let sdkData = {};
  const sdkDataRaw = tryRead(sdkDataPath);
  if (sdkDataRaw) {
    try { sdkData = JSON.parse(sdkDataRaw); }
    catch (_e) { /* tolerate bad JSON, use defaults */ }
  }

  // 2. source/pdxinfo
  const pdxinfoPath = path.join(sdkRoot, 'source', 'pdxinfo');
  const pdxinfoRaw = tryRead(pdxinfoPath);
  const pdxinfo = pdxinfoRaw ? parsePdxinfo(pdxinfoRaw) : {};

  // Derive metadata
  const title = sdkData.title || pdxinfo.name || project.name || 'Game';
  const description = sdkData.description || project.description || pdxinfo.description || '';
  const developer = sdkData.developer || project.developer || pdxinfo.author || 'Unknown';
  const sdkVersion = pdxinfo.sdkVersion || pdxinfo.playdate_sdk_version || '3.0.6';
  const mechanic = sdkData.mechanic_hook || sdkData.mechanic || '';
  const controls = mechanic
    ? `Primary input: ${mechanic}. Use the D-pad to navigate. A to confirm, B to cancel.`
    : 'Use D-pad to navigate. A to confirm, B to cancel. Crank for additional interactions.';

  // pdx name (safe filesystem slug derived from pdxinfo name or project id)
  const pdxName = (pdxinfo.name || project.id || 'game')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .toLowerCase()
    .slice(0, 48);

  // --- Prepare release directory ---
  const releaseDir = path.join(sdkRoot, 'release', tag);
  const pressskitDir = path.join(releaseDir, 'presskit');
  const screenshotsDir = path.join(releaseDir, 'screenshots');

  // Guard: refuse to overwrite unless force
  if (!force && fs.existsSync(releaseDir)) {
    const e = new Error(`release ${tag} already exists at ${releaseDir}; pass force=true to overwrite`);
    e.status = 409;
    throw e;
  }

  await fsp.rm(releaseDir, { recursive: true, force: true });
  await fsp.mkdir(releaseDir, { recursive: true });
  await fsp.mkdir(pressskitDir, { recursive: true });

  const files = [];

  function trackFile(filePath, kind) {
    files.push({ path: filePath, bytes: fileBytes(filePath), kind });
  }

  // --- 3. Latest .pdx ---
  const pdxSrc = latestPdxPath(projectId);
  const zipName = `${pdxName}-${tag}.pdx.zip`;
  const zipDest = path.join(releaseDir, zipName);

  if (pdxSrc) {
    // If the source is already a directory (.pdx is a dir), zip it.
    // If a .pdx.zip is somewhere nearby, prefer copying that.
    const pdxZipSrc = pdxSrc.replace(/\.pdx$/, '') + '.pdx.zip';
    const parentZips = fs.existsSync(path.dirname(pdxSrc))
      ? fs.readdirSync(path.dirname(pdxSrc)).filter((f) => f.endsWith('.pdx.zip'))
      : [];

    if (fs.existsSync(pdxZipSrc)) {
      await fsp.copyFile(pdxZipSrc, zipDest);
    } else if (parentZips.length > 0) {
      await fsp.copyFile(path.join(path.dirname(pdxSrc), parentZips[0]), zipDest);
    } else if (fs.statSync(pdxSrc).isDirectory()) {
      // Zip the directory in place
      const r = spawnSync('zip', ['-r', zipDest, path.basename(pdxSrc)], {
        cwd: path.dirname(pdxSrc),
        timeout: 30000
      });
      if (r.status !== 0) {
        // fallback: write a placeholder indicating no zip tool
        await fsp.writeFile(zipDest, `PDX: ${pdxSrc}\n`);
      }
    } else {
      // Single-file pdx — wrap in a zip
      const r = spawnSync('zip', ['-j', zipDest, pdxSrc], { timeout: 30000 });
      if (r.status !== 0) {
        await fsp.writeFile(zipDest, `PDX: ${pdxSrc}\n`);
      }
    }
  } else {
    // No built pdx yet — write a placeholder so the release dir is consistent
    await fsp.writeFile(zipDest, `# No built .pdx found for project ${projectId} at pack time.\n`);
  }
  trackFile(zipDest, 'pdx');

  // --- 4. Screenshots ---
  const recordingDir = path.join(sdkRoot, 'sdk_data', 'preview', 'recording');
  let screenshotsCopied = 0;
  if (include_screenshots && fs.existsSync(recordingDir)) {
    const pngs = fs.readdirSync(recordingDir).filter((f) => /\.png$/i.test(f));
    if (pngs.length > 0) {
      await fsp.mkdir(screenshotsDir, { recursive: true });
      for (const png of pngs) {
        const dest = path.join(screenshotsDir, png);
        await fsp.copyFile(path.join(recordingDir, png), dest);
        trackFile(dest, 'screenshot');
        screenshotsCopied++;
      }
    }
  }

  // --- 5. README.md ---
  const readmePath = path.join(releaseDir, 'README.md');
  await fsp.writeFile(readmePath, buildReadme({
    title, description, controls, sdkVersion, tag, developer, name: pdxName
  }), 'utf8');
  trackFile(readmePath, 'readme');

  // --- 6. CHANGELOG.md ---
  const changelogPath = path.join(releaseDir, 'CHANGELOG.md');
  const existingChangelog = tryRead(path.join(sdkRoot, 'CHANGELOG.md'));
  const prevTag = prevGitTag(sdkRoot, tag);
  const gitLog = gitLogSince(sdkRoot, prevTag);
  const buildDate = new Date().toISOString().slice(0, 10);
  await fsp.writeFile(changelogPath, buildChangelog({ tag, buildDate, gitLog, existingChangelog }), 'utf8');
  trackFile(changelogPath, 'changelog');

  // --- 7. LICENSE ---
  const licensePath = path.join(releaseDir, 'LICENSE');
  const year = new Date().getFullYear();
  await fsp.writeFile(licensePath, buildLicense(developer, year), 'utf8');
  trackFile(licensePath, 'license');

  // --- 8. build.sh ---
  const buildShPath = path.join(releaseDir, 'build.sh');
  await fsp.writeFile(buildShPath, buildBuildSh(pdxName, tag), 'utf8');
  try { fs.chmodSync(buildShPath, 0o755); } catch (_e) { /* not critical */ }
  trackFile(buildShPath, 'build_script');

  // --- 9. presskit/ ---
  // description.txt
  const storyExcerpt = storyBibleExcerpt(sdkRoot);
  const longDesc = [
    description,
    storyExcerpt ? '\n\n---\n\n' + storyExcerpt : ''
  ].filter(Boolean).join('');
  const descPath = path.join(pressskitDir, 'description.txt');
  await fsp.writeFile(descPath, longDesc || `${title}\n\n${description}\n`, 'utf8');
  trackFile(descPath, 'presskit');

  // controls.txt
  const controlsPath = path.join(pressskitDir, 'controls.txt');
  await fsp.writeFile(controlsPath, controls + '\n', 'utf8');
  trackFile(controlsPath, 'presskit');

  // credits.txt
  const creditsPath = path.join(pressskitDir, 'credits.txt');
  const creditsLines = [
    `Title: ${title}`,
    `Developer: ${developer}`,
    `Publisher: ${project.publisher || developer}`,
    `Platform: Playdate (play.date)`,
    `SDK Version: ${sdkVersion}`,
    `Tag: ${tag}`,
    `Build Date: ${buildDate}`,
    ''
  ];
  await fsp.writeFile(creditsPath, creditsLines.join('\n'), 'utf8');
  trackFile(creditsPath, 'presskit');

  // meta.json
  const metaPath = path.join(pressskitDir, 'meta.json');
  const byteSize = pdxSrc ? fileBytes(pdxSrc) : fileBytes(zipDest);
  const meta = {
    title,
    tag,
    sdk_version: sdkVersion,
    repo_url: project.repo || null,
    build_date: buildDate,
    byte_size: byteSize,
    developer,
    publisher: project.publisher || developer,
    bundle_id: pdxinfo.bundleID || null
  };
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  trackFile(metaPath, 'presskit');

  return {
    release_dir: releaseDir,
    tag,
    screenshots_copied: screenshotsCopied,
    pdx_zipped: !!pdxSrc,
    files
  };
}

// Return the most recently packed release for a project.
// Scans <sdkRoot>/release/ for subdirs and returns the manifest of the newest.
async function getLatestPack(projectId) {
  const project = await projects.getProject(projectId);
  if (!project || !project.local_path) return null;

  const releasesRoot = path.join(project.local_path, 'release');
  if (!fs.existsSync(releasesRoot)) return null;

  let entries;
  try {
    entries = fs.readdirSync(releasesRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({
        name: e.name,
        mtime: fs.statSync(path.join(releasesRoot, e.name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_e) {
    return null;
  }

  if (entries.length === 0) return null;

  const latest = entries[0];
  const releaseDir = path.join(releasesRoot, latest.name);

  // Scan the release dir for files
  const files = [];
  function scanDir(dir, relBase) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const item of items) {
      const full = path.join(dir, item.name);
      const rel = relBase ? `${relBase}/${item.name}` : item.name;
      if (item.isDirectory()) {
        scanDir(full, rel);
      } else {
        let kind = 'other';
        if (item.name === 'README.md') kind = 'readme';
        else if (item.name === 'CHANGELOG.md') kind = 'changelog';
        else if (item.name === 'LICENSE') kind = 'license';
        else if (item.name === 'build.sh') kind = 'build_script';
        else if (item.name.endsWith('.pdx.zip')) kind = 'pdx';
        else if (item.name.endsWith('.png')) kind = 'screenshot';
        else if (rel.startsWith('presskit/')) kind = 'presskit';
        files.push({ path: full, rel, bytes: fileBytes(full), kind });
      }
    }
  }
  scanDir(releaseDir, '');

  return { release_dir: releaseDir, tag: latest.name, files };
}

module.exports = { pack, getLatestPack, parsePdxinfo };
