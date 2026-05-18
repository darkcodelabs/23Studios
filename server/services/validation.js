'use strict';

const path = require('path');
const fs = require('fs');

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const PULP_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const REPO_RE = /^(https?:\/\/[\w.@:/~%-]+\.git|git@[\w.-]+:[\w./~%-]+\.git)$/;
const SAFE_CMD_RE = /^[A-Za-z0-9 _\-./]+$/;
const PLATFORMS = new Set(['playdate']);
const STATUSES = new Set(['active', 'paused', 'archived']);
const GAME_TYPES = new Set(['sdk', 'pulp']);

function isPlainString(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function validateId(id) {
  if (!isPlainString(id, 64) || !ID_RE.test(id)) {
    return 'id must be alphanumeric + hyphens, max 64 chars, start alphanumeric';
  }
  return null;
}

function validateRepo(repo) {
  if (!isPlainString(repo, 512) || !REPO_RE.test(repo)) {
    return 'repo must be a valid git URL (https://... .git or git@host:owner/repo.git)';
  }
  return null;
}

function validateLocalPath(localPath) {
  if (!isPlainString(localPath, 1024) || !path.isAbsolute(localPath)) {
    return 'local_path must be an absolute path';
  }
  let stat;
  try {
    stat = fs.lstatSync(localPath);
  } catch (_e) {
    return 'local_path does not exist';
  }
  if (stat.isSymbolicLink()) return 'local_path must not be a symlink';
  if (!stat.isDirectory()) return 'local_path must be a directory';
  if (!fs.existsSync(path.join(localPath, '.git'))) {
    return 'local_path must be a git repository (missing .git)';
  }
  return null;
}

function validatePlatform(p) {
  if (!isPlainString(p, 32) || !PLATFORMS.has(p)) {
    return `platform must be one of: ${Array.from(PLATFORMS).join(', ')}`;
  }
  return null;
}

function validateCommand(cmd, fieldName) {
  if (cmd === undefined || cmd === null || cmd === '') return null;
  if (!isPlainString(cmd, 256) || !SAFE_CMD_RE.test(cmd)) {
    return `${fieldName} contains disallowed characters (allow: A-Z a-z 0-9 space _ - . /)`;
  }
  return null;
}

function validateStatus(s) {
  if (s === undefined || s === null) return null;
  if (!STATUSES.has(s)) return `status must be one of: ${Array.from(STATUSES).join(', ')}`;
  return null;
}

function validateGameType(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !GAME_TYPES.has(v)) {
    return `game_type must be one of: ${Array.from(GAME_TYPES).join(', ')}`;
  }
  return null;
}

function validatePulpId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64 || !PULP_ID_RE.test(id)) {
    return 'id must match ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$';
  }
  return null;
}

// Optional-string check: empty string treated as "not provided".
function isOptionalString(v, max) {
  if (v === undefined || v === null || v === '') return true;
  return isPlainString(v, max);
}

function validateProjectCreate(input) {
  const errors = [];
  const push = (e) => { if (e) errors.push(e); };
  push(validateId(input.id));
  push(validateRepo(input.repo));
  push(validateLocalPath(input.local_path));
  push(validatePlatform(input.platform));
  push(validateCommand(input.build_command, 'build_command'));
  push(validateCommand(input.preflight_command, 'preflight_command'));
  push(validateStatus(input.status));
  push(validateGameType(input.game_type));
  if (!isPlainString(input.name, 200)) errors.push('name is required (max 200)');
  if (!isOptionalString(input.description, 1000)) errors.push('description must be string up to 1000 chars');
  if (!isOptionalString(input.publisher,   200))  errors.push('publisher must be string up to 200 chars');
  if (!isOptionalString(input.developer,   200))  errors.push('developer must be string up to 200 chars');
  if (!isOptionalString(input.captures_dir, 512)) errors.push('captures_dir must be string up to 512 chars');
  return errors;
}

function validateProjectPatch(input) {
  const errors = [];
  const push = (e) => { if (e) errors.push(e); };
  if (input.repo !== undefined) push(validateRepo(input.repo));
  if (input.local_path !== undefined) push(validateLocalPath(input.local_path));
  if (input.platform !== undefined) push(validatePlatform(input.platform));
  if (input.build_command !== undefined) push(validateCommand(input.build_command, 'build_command'));
  if (input.preflight_command !== undefined) push(validateCommand(input.preflight_command, 'preflight_command'));
  if (input.status !== undefined) push(validateStatus(input.status));
  if (input.game_type !== undefined) push(validateGameType(input.game_type));
  if (input.name        !== undefined && !isOptionalString(input.name, 200))         errors.push('name must be string up to 200');
  if (input.description !== undefined && !isOptionalString(input.description, 1000)) errors.push('description must be string up to 1000 chars');
  if (input.publisher   !== undefined && !isOptionalString(input.publisher, 200))    errors.push('publisher must be string up to 200');
  if (input.developer   !== undefined && !isOptionalString(input.developer, 200))    errors.push('developer must be string up to 200');
  if (input.captures_dir!== undefined && !isOptionalString(input.captures_dir, 512)) errors.push('captures_dir must be string up to 512');
  return errors;
}

function isPathInside(child, parent) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(parent, child);
  if (!resolvedChild.startsWith(resolvedParent + path.sep) && resolvedChild !== resolvedParent) {
    return false;
  }
  return true;
}

function validateRelativePath(rel) {
  if (typeof rel !== 'string') return 'path must be a string';
  if (rel.length > 1024) return 'path too long';
  if (rel.includes('\0')) return 'path contains null byte';
  if (path.isAbsolute(rel)) return 'path must be relative';
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p === '..' || p === '~')) return 'path must not contain .. or ~';
  return null;
}

module.exports = {
  validateId,
  validateRepo,
  validateLocalPath,
  validatePlatform,
  validateCommand,
  validateStatus,
  validateGameType,
  validatePulpId,
  validateProjectCreate,
  validateProjectPatch,
  validateRelativePath,
  isPathInside,
  PLATFORMS,
  STATUSES,
  GAME_TYPES
};
