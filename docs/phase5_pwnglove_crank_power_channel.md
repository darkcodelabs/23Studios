# Phase 5 PWNGLOVE Addendum: Crank as Power Channel

The Playdate crank stops being a UI selector and becomes the PWNGLOVE's **physical power source**. Every layer reads from a single `crank_rpm` global. Brightness, charge, signal strength, manipulation force — all derived from how hard the player is cranking right now.

This is the unifying mechanic that makes PWNGLOVE feel like a real device with a power budget, not a menu of unlocked abilities. It also gives HAKCD the platform-and-game alignment of *Mars After Midnight* / *Crankin's Time Travel Adventure* / *Casual Birder*: crank as first-class input, not decoration.

## Global state — `pwnglove_hud.lua`

A single shared module tracks instantaneous crank velocity. Every PWNGLOVE layer subscribes.

```lua
-- runtime/concepts/pwnglove_hud.lua exposes:
pwnglove_hud.crank_rpm           -- live, updated each frame from playdate.getCrankChange()
pwnglove_hud.crank_revs_total    -- monotonic, since session start
pwnglove_hud.crank_revs_since(t) -- delta since timestamp t
pwnglove_hud.active_layer        -- 'konami' | 'flipper.<tool>' | 'portal' | 'gravity' | 'tyson' | nil
pwnglove_hud.heat                -- 0..100, +1/sec when rpm > 200, -10/sec otherwise
pwnglove_hud.cooldown_until_ms   -- 0 if cool, else timestamp when heat resets to allow heavy work
```

NeoPixel array (rendered as a bottom-of-screen LED strip) **brightness = `crank_rpm / max_rpm`**. Slow crank = dim. Fast crank = full saturation. Pattern (1-bit dither cycle) = current layer.

## Per-layer integration

### Layer 1 — Konami buffer charging

Crank past the +30 floor to push it higher:

```
attempts = 30 + math.log(1 + crank_revs_post_konami) * 25
```

- 1 rev = 30
- 10 revs = 60
- 100 revs = 85
- asymptote at 100

Player decides how much to invest before the next minigame. Reverse-crank does nothing here (one-direction charge).

### Layer 2 — Flipper tool charge meters

Each tool has a charge requirement that decays when idle:

```lua
RFID_CLONE: needs 50 charge units, accumulates at crank_rpm * dt, decays at 5/sec when idle
SUB_GHZ:    signal_strength_dB = clamp(crank_rpm / 10, 0, 30), needs >= 15 to capture
IR_LEARN:   IR_intensity = crank_rpm * 0.5, range_meters = IR_intensity / 10
BLUE_BOX:   tone_hold_duration = total_crank_revs_during_hold * 0.2 seconds
IBUTTON:    emulation_freq_hz = crank_rpm * 100, lock window +/-5 Hz at 6000 Hz
BAD_USB:    script_chars_per_sec = clamp(crank_rpm / 2, 1, 60)
```

All six tools share the `pwnglove_hud.crank_rpm` reader. Tool-specific minigame UIs show the derived value (charge meter / signal bar / IR intensity / tone duration / freq lock / typing speed).

### Layer 3 — Portal gun spin-up

Hold B + crank to charge `portal_energy` (0..100). Destinations gate on threshold:

| Energy | Available destinations |
|---|---|
| 0–25 | Scenes in current act only |
| 25–60 | Any visited scene in same OR previous act |
| 60–100 | Any visited scene including SecKC hive |

Releasing B before energy >= 25 = portal collapse, **use is consumed**. The risk forces commitment.

### Layer 4 — Gravity gun manipulation

The cleanest crank mapping:

- **Slow crank** = move object precisely
- **Fast crank** = throw force scaling
- **Reverse crank** = pull object toward player from distance
- **Heavy objects** (server racks, refrigerators) require sustained high-RPM crank to lift at all — your arm gets tired, which is exactly how an EMF coil resonator would feel

Object mass → required RPM to lift:

| Object | Required RPM |
|---|---|
| Post-it / scrap of paper | 5 |
| Floppy disk | 20 |
| Modem | 60 |
| Server rack | 200+ |
| Refrigerator | 300+ sustained |

**Heat penalty:** sustained 200+ RPM heats the EMF coil. At `heat >= 100`, NeoPixels go red, lift is force-aborted, 3-second `cooldown_until_ms` before next heavy lift allowed. Light objects unaffected.

### Tyson code entry (refinement)

Crank-digit-select stays as spec'd. **Refinement:** each digit confirmed requires a brief reverse-crank flick to commit. Prevents accidental confirms during the 11-char entry. Total entry time ~15 seconds with practice.

## Visual feedback — `pwnglove_hud:draw()`

```lua
function pwnglove_hud:draw()
  -- 20-pixel LED strip across bottom of screen (4 LEDs per finger * 5 fingers)
  -- Brightness simulated by 1-bit dither density:
  --   crank_rpm / max_rpm => fraction of LEDs lit + dither pattern strength
  -- Pattern (1-bit dither cycle) by active layer:
  --   konami_armed:    pulsing all-on
  --   flipper_active:  cycle pattern matching tool
  --                    (rfid = sweep, ir = blink, blue_box = pulse-at-2600Hz, etc)
  --   portal_charging: progress bar across the array
  --   gravity_active:  ring around active object center
  --   tyson_unlock:    full rainbow simulated via dither cycle
  -- Heat overlay: when heat > 75, red checkerboard pattern over the strip
end
```

## Acceptance test additions

- **Crank → brightness visual:** Sideload, equip PWNGLOVE, watch NeoPixel array. Crank fast → all LEDs bright. Stop cranking → fade to dim. Validates `crank_rpm` global wired through `pwnglove_hud`.

- **RFID charge:** Activate RFID clone over a badge, crank steadily → charge meter fills, badge captures at 50 units.

- **Heavy gravity lift:** Try to lift a server rack with slow crank → fails. Crank hard (200+ RPM) → lift succeeds. After 3 seconds sustained, NeoPixels turn red, drop forced.

- **Portal energy thresholds:** Hold B + crank slowly → only nearby scenes selectable. Crank harder → more scenes appear in overlay. Release at full charge → warp to distant scene.

- **Tyson reverse-flick commits:** Enter `007-373-5963` via crank-digit selection. Each digit requires reverse-crank flick to commit. Verify TYSON MODE unlocks everything.

## Scope mitigation (+0 days)

Crank integration touches every PWNGLOVE module (~2 days extra for Team Runtime). Mitigation already chosen in multi-tool addendum: **drop the generic `lockpick_crank` recipe**. Real lockpicks in HAKCD route through PWNGLOVE Flipper suite (`blue_box` tool at Bell pedestal scene) — crank-controlled. Same mechanic, integrated into the multi-tool, no separate recipe needed.

**Net scope change: +0 days. Phase 5 still ships in 10.**

## Why this matters

Without crank-as-power, the four PWNGLOVE layers are unrelated menu items. With it, PWNGLOVE is a coherent device. The platform's signature input is the device's energy budget. NeoPixel brightness = RPM = the player's commitment in real time.

The Day-10 sideload demo writes itself: equip PWNGLOVE, point at a server rack, crank like hell, watch it lift. Then enter `007-373-5963` and watch everything light up. **That's the demo reel.**
