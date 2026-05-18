// intake_client.js — POST /api/projects/intake wrapper.

import { api } from './api.js';

export async function submitIntake(intake) {
  return api.post('/api/projects/intake', intake);
}

export const INTAKE_DEFAULTS = Object.freeze({
  pitch: '',
  genre: 'adventure',
  format: 'scene_based',
  setting_era: '',
  setting_location: '',
  setting_vibe: '',
  protagonist_name: '',
  protagonist_archetype: '',
  antagonist_or_obstacle: '',
  mentor_or_ally: '',
  visual_refs: ['', '', ''],
  visual_keywords: [],
  tone_refs: [''],
  tone_keywords: [],
  gameplay_refs: [''],
  crank_usage: 'central',
  accelerometer: false,
  audio_direction: 'synth',
  scene_count: 8,
  minigame_count: 2,
  playtime_target_min: 30,
  save_state: 'light',
  localization: ['en']
});

export const INTAKE_ENUMS = Object.freeze({
  genre: ['adventure', 'puzzle', 'action', 'narrative', 'sim', 'sports', 'life-sim', 'rhythm', 'toy', 'horror', 'other'],
  format: ['scene_based', 'hub_world', 'linear', 'roguelike', 'endless'],
  protagonist_archetype: ['', 'drifter', 'fixer', 'kid', 'exile', 'agent', 'courier', 'archivist', 'ghost', 'other'],
  crank_usage: ['central', 'secondary', 'decorative', 'none'],
  audio_direction: ['synth', 'tracker_chiptune', 'ambient_drone', 'jazz', 'textural', 'found_sound'],
  save_state: ['none', 'light', 'full']
});
