-- dialog_tree.lua — branching dialog runtime for 23studios SDK projects.
--
-- Per CLAUDE.md: HAKCD's dialog.lua stays a linear pool sampler. This
-- module is the SEPARATE branching dialog runtime for 23studios. Scenes
-- import whichever they need; some scenes import both.
--
-- Reads tree JSON from sdk_data/asset_library/npc_dialogs/<npc_id>.json
-- (schema defined in server/services/npc_dialog_tool.js).
--
-- Bootstrap pattern: load once in main.lua, self-binds to _G.dialog_tree.
-- Scenes access via the global, NEVER via local import.

local M = {}

local json = json  -- Playdate built-in JSON module
local current_tree = nil
local current_node_id = nil
local flags = {}
local on_say = nil       -- callback: function(speaker, text, node)
local on_choice = nil    -- callback: function(options, node) — must call M.pick(idx)
local on_end = nil       -- callback: function(flags)

local function node_by_id(tree, id)
  for _, n in ipairs(tree.nodes) do
    if n.id == id then return n end
  end
  return nil
end

local function advance()
  while current_node_id do
    local node = node_by_id(current_tree, current_node_id)
    if not node then
      if on_end then on_end(flags) end
      current_node_id = nil
      return
    end

    if node.type == 'end' then
      if on_end then on_end(flags) end
      current_node_id = nil
      return
    elseif node.type == 'say' then
      local speaker = node.speaker or 'npc'
      if on_say then on_say(speaker, node.text or '', node) end
      current_node_id = node.next
      return  -- wait for caller to call M.next()
    elseif node.type == 'set_flag' then
      flags[node.flag] = true
      current_node_id = node.next
      -- loop: chain through set_flag nodes without yielding
    elseif node.type == 'condition' then
      if flags[node.if_flag] then
        current_node_id = node.then_next
      else
        current_node_id = node.else_next
      end
      -- loop
    elseif node.type == 'choice' then
      if on_choice then on_choice(node.options or {}, node) end
      return  -- wait for caller to call M.pick(idx)
    else
      -- unknown type — terminate gracefully
      if on_end then on_end(flags) end
      current_node_id = nil
      return
    end
  end
end

-- ---- public API ----------------------------------------------------------

function M.load(npc_id, callbacks)
  callbacks = callbacks or {}
  on_say = callbacks.on_say
  on_choice = callbacks.on_choice
  on_end = callbacks.on_end

  local path = 'assets/npc_dialogs/' .. npc_id .. '.json'
  local file = playdate.file.open(path, playdate.file.kFileRead)
  if not file then
    print('dialog_tree: missing ' .. path)
    return false
  end
  local raw = ''
  local chunk = file:read(8192)
  while chunk and #chunk > 0 do
    raw = raw .. chunk
    chunk = file:read(8192)
  end
  file:close()

  current_tree = json.decode(raw)
  if not current_tree or not current_tree.entry_node then
    print('dialog_tree: bad tree ' .. npc_id)
    return false
  end

  current_node_id = current_tree.entry_node
  flags = callbacks.initial_flags or {}
  advance()
  return true
end

-- Caller calls this after the player advances past a "say" node.
function M.next()
  advance()
end

-- Caller calls this when the player picks an option index (0-based).
function M.pick(idx)
  local node = node_by_id(current_tree, current_node_id)
  if not node or node.type ~= 'choice' then return end
  local opt = node.options[idx + 1] or node.options[1]  -- Lua 1-indexed
  if not opt then return end
  if opt.sets_flag then flags[opt.sets_flag] = true end
  current_node_id = opt.next
  advance()
end

function M.get_flag(name) return flags[name] end
function M.get_flags() return flags end
function M.set_flag(name, val) flags[name] = val end
function M.is_active() return current_node_id ~= nil end

function M.reset()
  current_tree = nil
  current_node_id = nil
  flags = {}
  on_say = nil
  on_choice = nil
  on_end = nil
end

_G.dialog_tree = M
return M
