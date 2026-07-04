'use strict';

// Artifact validation for the prompt→Aseprite pipeline. Enforces the
// Playdate canon on every exported sheet BEFORE it can become a candidate:
//   - strict 1-bit: every pixel pure black or pure white, alpha 0 or 255
//   - imagetable naming: name-table-W-H.png, frame dims divide sheet dims
//   - frame dims match the asset spec exactly
// Mirrors visual_pack_factory/tools/_image_integrity.py semantics so both
// tracks reject the same defects.

const path = require('path');
const sharp = require('sharp');

const TABLE_RE = /-table-(\d+)-(\d+)\.png$/;

async function validate1bit(pngPath) {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bad = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a !== 0 && a !== 255) {
      bad.push({ offset: i / info.channels, why: 'alpha_midtone', a });
    } else if (a === 255) {
      const black = r === 0 && g === 0 && b === 0;
      const white = r === 255 && g === 255 && b === 255;
      if (!black && !white) {
        bad.push({ offset: i / info.channels, why: 'not_pure_bw', r, g, b });
      }
    }
    if (bad.length >= 8) break; // enough evidence; don't scan 400x240 for nothing
  }
  return {
    ok: bad.length === 0,
    code: bad.length ? 'not_1bit_color' : null,
    samples: bad,
    width: info.width,
    height: info.height,
  };
}

function validateTableName(fileName, expectW, expectH) {
  const m = TABLE_RE.exec(fileName);
  if (!m) return { ok: false, code: 'bad_table_name' };
  const fw = Number(m[1]);
  const fh = Number(m[2]);
  if (expectW && (fw !== expectW || fh !== expectH)) {
    return { ok: false, code: 'frame_dim_mismatch', got: [fw, fh], want: [expectW, expectH] };
  }
  return { ok: true, frameW: fw, frameH: fh };
}

// Validate one exported artifact against an asset spec:
// { frameW, frameH, frames, kind: 'imagetable' | 'image' }
async function validateArtifact(artifactPath, spec = {}) {
  const errors = [];
  const name = path.basename(artifactPath);

  const bit = await validate1bit(artifactPath);
  if (!bit.ok) errors.push({ code: bit.code, samples: bit.samples });

  if (spec.kind === 'imagetable') {
    const nm = validateTableName(name, spec.frameW, spec.frameH);
    if (!nm.ok) {
      errors.push({ code: nm.code, got: nm.got, want: nm.want });
    } else {
      if (bit.width % nm.frameW !== 0 || bit.height % nm.frameH !== 0) {
        errors.push({ code: 'sheet_not_frame_multiple', sheet: [bit.width, bit.height], frame: [nm.frameW, nm.frameH] });
      }
      if (spec.frames) {
        const cells = (bit.width / nm.frameW) * (bit.height / nm.frameH);
        if (cells < spec.frames) {
          errors.push({ code: 'too_few_frames', cells, want: spec.frames });
        }
      }
    }
  } else if (spec.frameW && (bit.width !== spec.frameW || bit.height !== spec.frameH)) {
    errors.push({ code: 'dimension_mismatch', got: [bit.width, bit.height], want: [spec.frameW, spec.frameH] });
  }

  return { ok: errors.length === 0, errors, width: bit.width, height: bit.height };
}

module.exports = { validateArtifact, validate1bit, validateTableName };
