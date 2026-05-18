-- Character registry. Characters carry an optional `imagetable` block:
--   imagetable = {
--     cols, rows, frame_w, frame_h,
--     states = { name = { row, count, fps, loop } }
--   }
-- Lua loader: gfx.imagetable.new("assets/characters/<id>") resolves the
-- on-disk file assets/characters/<id>-table-<W>-<H>.png (compiled to .pdt
-- at build time). Animated draws read frame_index_for + getImage(idx+1).

local gfx <const> = playdate and playdate.graphics or nil

local pulp = _G.pulp
local characters = { _by_id = {}, _table = {}, _state = {} }
pulp.characters = characters

function characters.load(list)
  characters._by_id = {}
  characters._table = {}
  characters._state = {}
  for _, c in ipairs(list or {}) do
    if c and c.id then
      characters._by_id[c.id] = c
      if c.imagetable and gfx then
        local base = 'assets/characters/' .. tostring(c.id)
        local ok, it = pcall(gfx.imagetable.new, base)
        if ok and it then characters._table[c.id] = it end
      end
      -- Default state = first state name in the table, if any.
      local first_state = nil
      if c.imagetable and type(c.imagetable.states) == 'table' then
        for name, _ in pairs(c.imagetable.states) do
          first_state = name; break
        end
      end
      characters._state[c.id] = {
        name = first_state,
        start_ms = playdate
          and playdate.getCurrentTimeMilliseconds
          and playdate.getCurrentTimeMilliseconds()
          or 0,
      }
    end
  end
end

function characters.get(id)
  return characters._by_id[tostring(id)]
end

function characters.set_state(id, state_name)
  local sid = tostring(id)
  local st = characters._state[sid]
  if not st then return end
  if st.name == state_name then return end
  st.name = state_name
  st.start_ms = playdate
    and playdate.getCurrentTimeMilliseconds
    and playdate.getCurrentTimeMilliseconds()
    or 0
end

-- Returns the image for character `id` in its current state, time-based
-- animation honouring fps + loop per the state config.
function characters.image_for(id)
  local sid = tostring(id)
  local c = characters._by_id[sid]
  local it = characters._table[sid]
  if not c or not it or not c.imagetable then return nil end
  local st = characters._state[sid] or {}
  local cfg = (c.imagetable.states or {})[st.name or ''] or { row = 0, count = 1, fps = 0, loop = true }
  local cols = c.imagetable.cols or 1
  local fps = cfg.fps or 0
  local count = math.max(1, cfg.count or 1)
  local idx = 0
  if fps > 0 and count > 1 then
    local now = playdate and playdate.getCurrentTimeMilliseconds and playdate.getCurrentTimeMilliseconds() or 0
    local raw = math.floor((now - (st.start_ms or now)) * fps / 1000)
    if cfg.loop == false then
      idx = math.min(count - 1, math.max(0, raw))
    else
      idx = raw % count
    end
  end
  -- Imagetable indices are 1-based, row-major.
  return it:getImage((cfg.row or 0) * cols + idx + 1)
end
