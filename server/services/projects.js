'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = process.env.PROJECTS_DATA_DIR
  ? path.resolve(process.env.PROJECTS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'projects.json');

let chain = Promise.resolve();
function withLock(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureFile() {
  try {
    await fsp.access(FILE);
  } catch (_e) {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await atomicWrite({ projects: [] });
  }
}

async function atomicWrite(data) {
  const tmp = FILE + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, FILE);
}

async function readAll() {
  await ensureFile();
  const raw = await fsp.readFile(FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.projects)) return { projects: [] };
    return parsed;
  } catch (_e) {
    return { projects: [] };
  }
}

function sanitize(p) {
  if (!p) return p;
  const {
    id, name, description, repo, local_path, platform,
    publisher, developer, build_command, preflight_command,
    captures_dir, created_at, status
  } = p;
  const game_type = p.game_type === 'pulp' ? 'pulp' : 'sdk';
  return {
    id, name, description, repo, local_path, platform,
    publisher, developer, build_command, preflight_command,
    captures_dir, created_at, status, game_type
  };
}

async function listProjects() {
  const data = await readAll();
  return data.projects.map(sanitize);
}

async function getProject(id) {
  const data = await readAll();
  const found = data.projects.find((p) => p.id === id);
  return found ? sanitize(found) : null;
}

function createProject(input) {
  return withLock(async () => {
    const data = await readAll();
    if (data.projects.some((p) => p.id === input.id)) {
      const err = new Error('project id already exists');
      err.status = 409;
      err.code = 'duplicate_id';
      throw err;
    }
    const record = {
      id: input.id,
      name: input.name,
      description: input.description || '',
      repo: input.repo,
      local_path: input.local_path,
      platform: input.platform,
      publisher: input.publisher || '',
      developer: input.developer || '',
      build_command: input.build_command || '',
      preflight_command: input.preflight_command || '',
      captures_dir: input.captures_dir || '',
      created_at: input.created_at || todayIso(),
      status: input.status || 'active',
      game_type: input.game_type === 'pulp' ? 'pulp' : 'sdk'
    };
    data.projects.push(record);
    await atomicWrite(data);
    return sanitize(record);
  });
}

function patchProject(id, patch) {
  return withLock(async () => {
    const data = await readAll();
    const idx = data.projects.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const next = { ...data.projects[idx], ...patch, id };
    data.projects[idx] = next;
    await atomicWrite(data);
    return sanitize(next);
  });
}

function deleteProject(id) {
  return withLock(async () => {
    const data = await readAll();
    const before = data.projects.length;
    data.projects = data.projects.filter((p) => p.id !== id);
    if (data.projects.length === before) return false;
    await atomicWrite(data);
    return true;
  });
}

function seedIfEmpty(seed) {
  return withLock(async () => {
    const data = await readAll();
    if (data.projects.length > 0) return false;
    data.projects = seed;
    await atomicWrite(data);
    return true;
  });
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  patchProject,
  deleteProject,
  seedIfEmpty
};
