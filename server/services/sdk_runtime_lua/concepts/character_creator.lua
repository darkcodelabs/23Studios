-- sdk_runtime_lua/concepts/character_creator.lua
-- Reusable crank + d-pad driven character creator kit (kit id:
-- character_creator_crank). Scenes instantiate it with a config and
-- forward update/draw/input + crank events. No renderer baked in --
-- this module owns layout + compositing, but it stays minimal so a scene
-- can re-skin around it.
--
-- API:
--   character_creator.new(config) -> instance
--   :update(dt)
--   :draw()
--   :input(evt)        -- "a" / "b" / "up" / "down" / "left" / "right"
--   :on_crank(degrees)
--   :teardown()
--   :get_selection()   -> table of {category_id -> option_index|string}
--
-- Config shape:
--   {
--     storage_key  = "scene_id_avatar",          -- datastore slot
--     categories   = { ... see below ... },
--     on_confirm   = function(selection) end,    -- fired on A in final preview
--     on_cancel    = function() end,             -- fired on B in first category
--     preview = { x=140, y=30, w=120, h=180 }    -- optional override
--   }
--
-- Category shape (visual / option-cycle slot):
--   { id="head_shape", label="HEAD",
--     imagetable_path="images/avatar_head",      -- optional; debug stub if missing
--     option_count=8 }                           -- inferred from imagetable len if absent
--
-- Category shape (keyboard slot, must be the last category):
--   { id="name", label="NAME", kind="keyboard", max_length=12 }
--
-- Persistence:
--   Calling on_confirm passes the full selection table. The kit also
--   writes the selection to playdate.datastore under storage_key so a
--   subsequent boot can rehydrate the avatar without re-running the
--   creator.
--
-- Controls (drawn in the bottom strip):
--   [CRANK] browse  [D-PAD] category  [A] next  [B] back
--
-- Crank: 18 degrees per discrete option tick (same quantum as char_wheel
-- for muscle-memory consistency across HAKCD-derived games).
--
-- Deferred / NOT implemented (left for future passes):
--   - Live composite preview (current draw renders selected option index
--     numerically; a project can override :draw() or wrap this module to
--     stack the imagetable frames into a 120x180 preview).
--   - Animation between option changes.
--   - Per-category randomize-all shortcut.
--   - i18n of category labels (caller passes literal strings today).
--   - Audio hooks (SFX on tick / commit) -- left to caller; pump via the
--     scene's audio_manager when on_change fires.

local M = {}
M.__index = M

local CRANK_QUANTUM = 18
local DEFAULT_PREVIEW = { x = 140, y = 30, w = 120, h = 180 }

local DEBUG_STUB_OPTIONS = 6 -- when no imagetable supplied, pretend 6 options exist

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function category_option_count(cat, loaded_imagetable)
    if cat.kind == "keyboard" then return 0 end
    if cat.option_count and cat.option_count > 0 then return cat.option_count end
    if loaded_imagetable then
        local n = loaded_imagetable:getLength()
        if n and n > 0 then return n end
    end
    return DEBUG_STUB_OPTIONS
end

local function load_imagetable_if_available(path)
    if not path then return nil end
    if playdate == nil or playdate.graphics == nil then return nil end
    local ok, it = pcall(function() return playdate.graphics.imagetable.new(path) end)
    if ok and it then return it end
    return nil
end

local function new_default_selection(categories, imagetables)
    local sel = {}
    for i, cat in ipairs(categories) do
        if cat.kind == "keyboard" then
            sel[cat.id] = ""
        else
            sel[cat.id] = 1
        end
        -- prime the per-category total so cycling math has a stable max
        cat._option_count = category_option_count(cat, imagetables[i])
    end
    return sel
end

local function rehydrate_selection(storage_key, categories, imagetables)
    local sel = new_default_selection(categories, imagetables)
    if not storage_key then return sel end
    if playdate == nil or playdate.datastore == nil then return sel end
    local loaded = playdate.datastore.read(storage_key)
    if type(loaded) ~= "table" then return sel end
    for _, cat in ipairs(categories) do
        local v = loaded[cat.id]
        if cat.kind == "keyboard" then
            if type(v) == "string" then sel[cat.id] = v end
        else
            local n = tonumber(v)
            if n and cat._option_count > 0 then
                sel[cat.id] = clamp(math.floor(n), 1, cat._option_count)
            end
        end
    end
    return sel
end

-- ---------------------------------------------------------------------
-- Construction
-- ---------------------------------------------------------------------

function M.new(config)
    config = config or {}
    assert(type(config.categories) == "table" and #config.categories > 0,
        "character_creator: config.categories must be a non-empty list")

    local self = setmetatable({}, M)
    self.config       = config
    self.categories   = config.categories
    self.preview      = config.preview or DEFAULT_PREVIEW
    self.storage_key  = config.storage_key
    self.on_confirm   = config.on_confirm
    self.on_cancel    = config.on_cancel

    self.imagetables = {}
    for i, cat in ipairs(self.categories) do
        self.imagetables[i] = load_imagetable_if_available(cat.imagetable_path)
    end

    self.selection      = rehydrate_selection(self.storage_key, self.categories, self.imagetables)
    self.active_index   = 1
    self.crank_accum    = 0
    self.keyboard_open  = false
    self.confirmed      = false
    self.change_event_count = 0
    self.lock_event_count   = 0
    return self
end

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------

local function current_category(self)
    return self.categories[self.active_index]
end

local function advance_category(self, dir)
    local n = #self.categories
    self.active_index = ((self.active_index - 1 + dir) % n + n) % n + 1
    self.crank_accum  = 0
end

local function cycle_option(self, dir)
    local cat = current_category(self)
    if cat == nil or cat.kind == "keyboard" then return end
    local count = cat._option_count or 0
    if count <= 0 then return end
    local cur = self.selection[cat.id] or 1
    cur = ((cur - 1 + dir) % count + count) % count + 1
    self.selection[cat.id] = cur
    self.change_event_count = self.change_event_count + 1
end

local function open_keyboard_if_needed(self)
    local cat = current_category(self)
    if cat == nil or cat.kind ~= "keyboard" then return end
    if self.keyboard_open then return end
    if playdate == nil or playdate.keyboard == nil then return end
    self.keyboard_open = true
    playdate.keyboard.keyboardWillHideCallback = function(ok)
        self.keyboard_open = false
        if ok then
            local txt = playdate.keyboard.text or ""
            local max_len = cat.max_length or 12
            if #txt > max_len then txt = string.sub(txt, 1, max_len) end
            self.selection[cat.id] = txt
        end
    end
    playdate.keyboard.show(self.selection[cat.id] or "")
end

local function persist_selection(self)
    if not self.storage_key then return end
    if playdate == nil or playdate.datastore == nil then return end
    local out = {}
    for k, v in pairs(self.selection) do out[k] = v end
    playdate.datastore.write(out, self.storage_key)
end

local function confirm(self)
    if self.confirmed then return end
    self.confirmed = true
    persist_selection(self)
    self.lock_event_count = self.lock_event_count + 1
    if self.on_confirm then self.on_confirm(self.selection) end
end

local function cancel(self)
    if self.on_cancel then self.on_cancel() end
end

-- ---------------------------------------------------------------------
-- Tick / input
-- ---------------------------------------------------------------------

function M:update(_dt)
    -- Auto-open the keyboard the first frame we land on a keyboard slot.
    local cat = current_category(self)
    if cat and cat.kind == "keyboard" and not self.keyboard_open then
        open_keyboard_if_needed(self)
    end
end

function M:on_crank(degrees)
    if self.confirmed then return end
    if self.keyboard_open then return end
    if degrees == nil or degrees == 0 then return end
    self.crank_accum = self.crank_accum + degrees
    while self.crank_accum >= CRANK_QUANTUM do
        cycle_option(self,  1)
        self.crank_accum = self.crank_accum - CRANK_QUANTUM
    end
    while self.crank_accum <= -CRANK_QUANTUM do
        cycle_option(self, -1)
        self.crank_accum = self.crank_accum + CRANK_QUANTUM
    end
end

function M:input(evt)
    if self.confirmed then return end
    if self.keyboard_open then
        -- While keyboard is up, the system handles input; ignore game buttons.
        return
    end
    if evt == "up"   then advance_category(self, -1) return end
    if evt == "down" then advance_category(self,  1) return end
    if evt == "left"  then cycle_option(self, -1) return end
    if evt == "right" then cycle_option(self,  1) return end

    if evt == "a" then
        if self.active_index >= #self.categories then
            confirm(self)
        else
            self.active_index = self.active_index + 1
            self.crank_accum = 0
            if current_category(self).kind == "keyboard" then
                open_keyboard_if_needed(self)
            end
        end
        return
    end

    if evt == "b" then
        if self.active_index > 1 then
            self.active_index = self.active_index - 1
            self.crank_accum = 0
        else
            cancel(self)
        end
        return
    end
end

function M:teardown()
    if self.keyboard_open and playdate and playdate.keyboard then
        playdate.keyboard.hide()
    end
end

function M:get_selection()
    local out = {}
    for k, v in pairs(self.selection) do out[k] = v end
    return out
end

function M:get_change_event_count() return self.change_event_count end
function M:get_lock_event_count()   return self.lock_event_count   end

-- ---------------------------------------------------------------------
-- Default draw. Scenes may override by skipping :draw() and rendering
-- entirely from :get_selection() + their own composite logic.
-- ---------------------------------------------------------------------

function M:draw()
    if playdate == nil or playdate.graphics == nil then return end
    local gfx = playdate.graphics

    gfx.clear(gfx.kColorWhite)

    -- Preview frame.
    local p = self.preview
    gfx.drawRect(p.x, p.y, p.w, p.h)

    -- Stack the locked imagetable frames into the preview rect to
    -- produce a basic composite. Each layer draws at preview origin;
    -- artists supply pre-aligned imagetables so frames superimpose.
    for i, cat in ipairs(self.categories) do
        if cat.kind ~= "keyboard" then
            local it = self.imagetables[i]
            local idx = self.selection[cat.id]
            if it and idx then
                local img = it:getImage(idx)
                if img then img:draw(p.x, p.y) end
            end
        end
    end

    -- Right rail: category list.
    local rail_x = p.x + p.w + 16
    local rail_y = p.y
    for i, cat in ipairs(self.categories) do
        local label = cat.label or cat.id
        local row_y = rail_y + (i - 1) * 22
        if i == self.active_index then
            gfx.fillRect(rail_x - 4, row_y - 2, 130, 20)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawText(label, rail_x, row_y)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
        else
            gfx.drawText(label, rail_x, row_y)
        end
        -- Current selection summary on the right of the row.
        local sel_v = self.selection[cat.id]
        local summary
        if cat.kind == "keyboard" then
            summary = (sel_v == nil or sel_v == "") and "(set name)" or tostring(sel_v)
        else
            local total = cat._option_count or 0
            summary = string.format("%d/%d", tonumber(sel_v) or 0, total)
        end
        gfx.drawText(summary, rail_x + 86, row_y)
    end

    -- Left side: portrait label of the active category and current option.
    local active = current_category(self)
    if active then
        gfx.drawText("CATEGORY", 8, 30)
        gfx.drawText(active.label or active.id, 8, 50)
        if active.kind == "keyboard" then
            gfx.drawText("(keyboard)", 8, 80)
        else
            gfx.drawText(string.format("option %d", self.selection[active.id] or 0), 8, 80)
        end
    end

    -- Bottom controls strip.
    gfx.drawText("[CRANK] browse  [D-PAD] category  [A] next  [B] back", 8, 220)
end

_G.character_creator = M
return M
