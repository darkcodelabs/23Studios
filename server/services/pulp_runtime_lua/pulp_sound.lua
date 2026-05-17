-- Sound + song registries and playback shims.

local pulp = _G.pulp
local sounds = { _by_id = {} }
local songs = { _by_id = {}, _current = nil }
pulp.sounds = sounds
pulp.songs = songs

function sounds.load(list)
  sounds._by_id = {}
  for _, s in ipairs(list or {}) do sounds._by_id[s.id] = s end
end

function songs.load(list)
  songs._by_id = {}
  for _, s in ipairs(list or {}) do songs._by_id[s.id] = s end
end

local function play_sample(spec)
  if not spec then return end
  if playdate and playdate.sound and playdate.sound.synth then
    local syn = playdate.sound.synth.new(playdate.sound.kWave[spec.waveform] or playdate.sound.kWaveSine)
    syn:setADSR(
      (spec.envelope and spec.envelope.attack or 5) / 1000,
      (spec.envelope and spec.envelope.decay or 50) / 1000,
      (spec.envelope and spec.envelope.sustain or 0.6),
      (spec.envelope and spec.envelope.release or 80) / 1000
    )
    syn:playNote(spec.freq_start or 440, 1, (spec.duration_ms or 200) / 1000)
  end
end

function pulp.sound(id) play_sample(sounds._by_id[tostring(id)]) end
function pulp.once(id) play_sample(sounds._by_id[tostring(id)]) end

function pulp.loop(id)
  songs._current = tostring(id)
  -- Real loop implementation requires Playdate sequencer; stubbed here.
end

function pulp.stop(id)
  songs._current = nil
end

function pulp.bpm(n)
  songs._bpm = tonumber(n) or 120
end

function songs.loop(id) pulp.loop(id) end
function songs.stop()   pulp.stop()  end
