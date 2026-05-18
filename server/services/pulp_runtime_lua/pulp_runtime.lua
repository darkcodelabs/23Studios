-- 23 Studios Pulp runtime. Loaded by main.lua before any generated script.
-- Exposes the `pulp` global expected by codegen.js output.
-- Stubs Playdate SDK calls behind `if playdate then ... end` so generated
-- modules can also be loaded under stock Lua 5.4 for unit testing.

local M = {}
_G.pulp = M

M.vars   = {}
M.event  = { last = nil }
M.config = {
  auto_act      = true,
  input_repeat  = true,
  follow_player = false,
  text_speed    = 20,
}

-- Loaded sub-modules expose their own surfaces back onto `pulp`.
require('runtime.pulp_tiles')
require('runtime.pulp_rooms')
require('runtime.pulp_sound')
require('runtime.pulp_player')
require('runtime.pulp_characters')

-- --------------------------------------------------------------------------
-- Event dispatch
-- --------------------------------------------------------------------------
M._handlers = {}   -- handlers[namespace][event] = fn

function M.listen(namespace, event, fn)
  M._handlers[namespace] = M._handlers[namespace] or {}
  M._handlers[namespace][event] = fn
end

local function dispatch(namespace, event, payload)
  local ns = M._handlers[namespace]
  if not ns then return end
  local fn = ns[event]
  if not fn then return end
  local prev_event = M.event
  M.event = payload or prev_event or {}
  local ok, err = pcall(fn, M.event)
  M.event = prev_event
  if not ok and M.log then M.log('handler error: ' .. tostring(err)) end
end
M.dispatch = dispatch

-- A `tell` block sets a contextual target (tile/room) so commands inside
-- the block route to that target by default.
local tell_stack = {}

function M.tell(target, fn)
  tell_stack[#tell_stack + 1] = target
  local prev_tile_id = M.event and M.event.tile_id
  if M.event then M.event.tile_id = target end
  local ok, err = pcall(fn)
  if M.event then M.event.tile_id = prev_tile_id end
  tell_stack[#tell_stack] = nil
  if not ok and M.log then M.log('tell error: ' .. tostring(err)) end
end

function M.current_target()
  return tell_stack[#tell_stack]
end

-- call/emit/mimic semantics (PulpScript dispatch primitives)
-- call: invoke handler named `name` on the current target
-- emit: invoke handler named `name` on every tile in the project
-- mimic: copy handler from another tile and run it once
function M.call(name)
  local tgt = M.current_target() or 'game'
  dispatch(tostring(tgt), name, M.event)
end

function M.emit(name)
  for ns, _ in pairs(M._handlers) do
    dispatch(ns, name, M.event)
  end
end

function M.mimic(name)
  -- name expected as "ns.event" or just "event" on current target.
  local ns, event = string.match(tostring(name), '^([^%.]+)%.(.+)$')
  if not ns then
    ns = tostring(M.current_target() or 'game')
    event = tostring(name)
  end
  dispatch(ns, event, M.event)
end

-- --------------------------------------------------------------------------
-- Deferred continuation (used after say/play/wait/etc.)
-- --------------------------------------------------------------------------
M._continuations = {}

function M.then_after(fn)
  M._continuations[#M._continuations + 1] = fn
end

function M.flush_continuations()
  while #M._continuations > 0 do
    local fn = table.remove(M._continuations, 1)
    local ok, err = pcall(fn)
    if not ok and M.log then M.log('continuation error: ' .. tostring(err)) end
  end
end

-- --------------------------------------------------------------------------
-- String formatting — supports {var} and {n,c:var} padding
-- --------------------------------------------------------------------------
local function pad_str(s, width, pad_char)
  s = tostring(s)
  width = tonumber(width) or 0
  pad_char = pad_char or ' '
  if #s >= width then return s end
  return string.rep(pad_char, width - #s) .. s
end

function M.fmt(template, vars)
  vars = vars or {}
  return (string.gsub(tostring(template), '{([^}]+)}', function(inner)
    local fmt_spec, name = string.match(inner, '^([^:]+):(.+)$')
    if not name then
      fmt_spec, name = nil, inner
    end
    name = name and name:gsub('^%s*(.-)%s*$', '%1')
    local v = vars[name]
    if v == nil then v = M.vars[name] end
    if v == nil then v = '' end
    if fmt_spec then
      local width, pad_char = string.match(fmt_spec, '^(%d+),(.)$')
      if width then return pad_str(v, tonumber(width), pad_char) end
    end
    return tostring(v)
  end))
end

-- --------------------------------------------------------------------------
-- Dialog primitives
-- --------------------------------------------------------------------------
function M.say(text, opts)
  if playdate and playdate.graphics then
    -- Real implementation populated by the SDK dialog widget.
    M._last_dialog = { kind = 'say', text = tostring(text), opts = opts }
  else
    M.log('say: ' .. tostring(text))
  end
end

function M.ask(spec)
  M._last_dialog = { kind = 'ask', spec = spec }
end

function M.menu(spec)
  M._last_dialog = { kind = 'menu', spec = spec }
end

function M.fin(text)
  M._last_dialog = { kind = 'fin', text = tostring(text) }
  M.log('fin: ' .. tostring(text))
end

-- --------------------------------------------------------------------------
-- Custom-draw event helpers (no-ops outside an `on draw` handler)
-- --------------------------------------------------------------------------
function M.hide() end
function M.window(x, y, w, h) M._window = { x = x, y = y, w = w, h = h } end
function M.label(text, x, y) end
function M.fill(x, y, w, h, on) end
function M.crop(x, y, w, h) end

-- --------------------------------------------------------------------------
-- Persistence (Lua table -> JSON-ish via Playdate datastore when available)
-- --------------------------------------------------------------------------
local store = {}

function M.store(key, value)
  store[tostring(key)] = value
  if playdate and playdate.datastore then
    pcall(playdate.datastore.write, store, 'pulp_store')
  end
end

function M.restore(key)
  if playdate and playdate.datastore and next(store) == nil then
    local ok, data = pcall(playdate.datastore.read, 'pulp_store')
    if ok and type(data) == 'table' then store = data end
  end
  return store[tostring(key)]
end

function M.toss(key)
  store[tostring(key)] = nil
end

-- --------------------------------------------------------------------------
-- Misc
-- --------------------------------------------------------------------------
function M.shake(intensity)
  if playdate and playdate.display then
    -- TODO: hook into Playdate display offset
  end
end

function M.wait(seconds)
  if playdate and playdate.timer then
    playdate.timer.performAfterDelay(math.floor((tonumber(seconds) or 0) * 1000), function()
      M.flush_continuations()
    end)
  end
end

function M.listen_input() M.config.input_locked = false end
function M.ignore_input() M.config.input_locked = true end

function M.act()
  -- Default interaction on current target
  M.call('confirm')
end

function M.log(text)
  if M._console then
    M._console[#M._console + 1] = tostring(text)
  end
  if playdate and print then print(tostring(text)) end
end

function M.dump()
  for k, v in pairs(M.vars) do M.log(tostring(k) .. ' = ' .. tostring(v)) end
end

function M.call_command(name, args)
  M.log('unknown command: ' .. tostring(name))
end

-- --------------------------------------------------------------------------
-- Query commands
-- --------------------------------------------------------------------------
M.query = {}

function M.query.random(min, max)
  min = tonumber(min) or 0
  max = tonumber(max) or 1
  if max < min then min, max = max, min end
  return math.random(math.floor(min), math.floor(max))
end

function M.query.floor(x)   return math.floor(tonumber(x) or 0) end
function M.query.ceil(x)    return math.ceil(tonumber(x)  or 0) end
function M.query.round(x)
  local n = tonumber(x) or 0
  return n >= 0 and math.floor(n + 0.5) or math.ceil(n - 0.5)
end
function M.query.sine(x)    return math.sin(tonumber(x) or 0) end
function M.query.cosine(x)  return math.cos(tonumber(x) or 0) end
function M.query.tangent(x) return math.tan(tonumber(x) or 0) end
function M.query.radians(x) return (tonumber(x) or 0) * math.pi / 180 end
function M.query.degrees(x) return (tonumber(x) or 0) * 180 / math.pi end

function M.query.solid(x, y)
  if not M.rooms or not M.rooms.tile_at then return false end
  local t = M.rooms.tile_at(x, y)
  return t and t.solid or false
end

function M.query.type(x, y)
  if not M.rooms or not M.rooms.tile_at then return '' end
  local t = M.rooms.tile_at(x, y)
  return t and t.type or ''
end

function M.query.id(x, y)
  if not M.rooms or not M.rooms.tile_at then return '' end
  local t = M.rooms.tile_at(x, y)
  return t and t.id or ''
end

function M.query.name(x, y)
  if not M.rooms or not M.rooms.tile_at then return '' end
  local t = M.rooms.tile_at(x, y)
  return t and t.name or ''
end

function M.query.invert(x, y)
  -- Returns whether the tile at (x,y) is in inverted (1-bit flipped) state.
  return false
end

function M.query.frame(target)
  if not M.tiles or not M.tiles.get_frame then return 0 end
  return M.tiles.get_frame(target) or 0
end

-- --------------------------------------------------------------------------
-- Datetime
-- --------------------------------------------------------------------------
function M.datetime()
  if playdate and playdate.getTime then
    local t = playdate.getTime()
    return {
      year = t.year, month = t.month, day = t.day,
      hour = t.hour, minute = t.minute, second = t.second,
      weekday = t.weekday or 0
    }
  end
  local t = os.date('*t') or {}
  return {
    year = t.year, month = t.month, day = t.day,
    hour = t.hour, minute = t.min, second = t.sec,
    weekday = t.wday
  }
end

-- --------------------------------------------------------------------------
-- Boot helper used by main.lua
-- --------------------------------------------------------------------------
function M.boot(game_data)
  M._game = game_data or {}
  if M.tiles      and M.tiles.load      then M.tiles.load(M._game.tiles)           end
  if M.rooms      and M.rooms.load      then M.rooms.load(M._game.rooms)           end
  if M.sounds     and M.sounds.load     then M.sounds.load(M._game.sounds)         end
  if M.songs      and M.songs.load      then M.songs.load(M._game.songs)           end
  if M.characters and M.characters.load then M.characters.load(M._game.characters) end
  if M._game.config then
    for k, v in pairs(M._game.config) do M.config[k] = v end
  end
  if M.player and M.player.load then M.player.load(M._game.player) end
  -- Fire `on load` then `on start` on the game namespace.
  dispatch('game', 'load', { kind = 'load' })
  dispatch('game', 'start', { kind = 'start' })
end

return M
