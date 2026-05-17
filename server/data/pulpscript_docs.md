# PulpScript Language Reference

> Source: https://play.date/pulp/docs/pulpscript/ (fetched 2026-05-17)
> This document is the canonical reference for the PulpScript -> Lua transpiler
> and the JS interpreter (Agent E). Keep in sync with upstream.

## Event Handlers

Syntax:

```pulp
on eventName do
    // code
end
```

### Built-in Events

| Event      | Trigger                                                         |
|------------|-----------------------------------------------------------------|
| `load`     | Once when assets load (game, rooms, tiles)                      |
| `start`    | Once after all load events complete                             |
| `enter`    | Player enters a room                                            |
| `exit`     | Player leaves a room                                            |
| `finish`   | Game completes                                                  |
| `loop`     | 20× per second before frame updates                             |
| `update`   | Player moves or interacts                                       |
| `bump`     | Player collides with a solid tile                               |
| `confirm`  | A button pressed                                                |
| `cancel`   | B button pressed                                                |
| `crank`    | Crank rotates                                                   |
| `dock`     | Crank docks                                                     |
| `undock`   | Crank undocks                                                   |
| `draw`     | Player every frame before rendering                             |
| `interact` | Sprite when Player bumps/acts upon it                           |
| `collect`  | Item when Player steps on/acts upon it                          |
| `change`   | Menu cursor moves or menu appears                               |
| `select`   | Option selected in menu                                         |
| `dismiss`  | Submenu dismissed                                               |
| `invalid`  | Invalid menu action                                             |
| `any`      | Catch-all event before any other event                          |

### Custom Events

```pulp
call "eventName"   // dispatch on current tile/room/game
emit "eventName"   // dispatch on all tiles handling it
```

## Variables & Assignment

* Globally scoped, default value `0`.
* Hold numbers or strings (strings always double-quoted).
* `varName = 0` / `varName = "text"`.

## Operators

* Comparison: `==` `!=` `>` `<` `>=` `<=`
* Arithmetic: `+` `-` `*` `/`
* Assignment: `=` `+=` `-=` `*=` `/=` `++` `--`

## Control Flow

```pulp
if condition then
    // ...
elseif condition then
    // ...
else
    // ...
end

while condition do
    // ...
end

done   // early exit from current handler
```

## Comments

```pulp
// single-line
```

## String Features

* Interpolation: `"text {varName} more"`
* Padded numbers: `"{6,0:score}"` (width 6, pad with `0`, left-pad).
* Right-pad text: `"{label:8, }"` (width 8, pad with space, right-pad).
* Embedded tiles: `"{embed:tileName}"`
* Escapes: `\n` (newline), `\f` (form feed)

## Core Functions

### Text Display
* `say "message"` / `say "message" at x,y` / `say "message" at x,y,w,h` (optional `then` block)
* `ask "question" then option "text" then ... end`
* `menu at x,y,w,h then option "text" then ... end`
* `fin "message"` — display and mark game finished.

### Game State
* `goto x,y` / `goto x,y in "roomName"`
* `swap tileId` / `swap "tileName"`
* `play tileName` (optional `then`)
* `wait duration then ... end`
* `shake duration` (optional `then`)

### Tile Interaction
* `tell x,y to ... end` / `tell tileName to ... end`
* `call "eventName"`, `emit "eventName"`, `mimic "tileName"`
* `act` — trigger default interaction.

### Drawing (Player `draw` handler only)
* `draw "tileName" at x,y`
* `hide`
* `window at x,y,w,h`
* `label "text" at x,y,len,lines`
* `fill "white"|"black" at x,y,w,h`
* `crop to x,y,w,h`

### Input
* `listen` / `ignore`

### Audio
* `sound "soundName"`, `once "songName"` (opt `then`), `loop "songName"`, `stop`, `bpm n`

### Persistence
* `store "name"` / `store` (all)
* `restore "name"` / `restore` (all)
* `toss "name"` / `toss` (all)

### Queries / Misc
* `frame` (get/set current tile frame)
* `log "message"`, `dump`
* `solid x,y` / `solid "tileName"`
* `type x,y` / `type "tileName"`
* `id x,y` / `id "tileName"`
* `name x,y` / `name tileId`
* `invert` (toggle/query inversion)

## Math Functions

* `random max` / `random min,max`
* `floor n`, `ceil n`, `round n`
* `sine n` (rad), `cosine n` (rad), `tangent n` (rad)
* `radians degrees`, `degrees radians`

## Special Variables

### `event` (read-only)
`event.dx`, `event.dy`, `event.tx`, `event.ty`, `event.x`, `event.y`,
`event.room`, `event.px`, `event.py`, `event.tile`, `event.option`,
`event.aa`, `event.ra`, `event.frame`, `event.ax`, `event.ay`, `event.az`,
`event.orientation`, `event.game`, `event.room`, `event.player` (tell targets).

### `config` (overridable)
`autoAct` (1), `inputRepeat` (1), `inputRepeatDelay` (0.4),
`inputRepeatBetween` (0.2), `follow` (0), `followCenterX` (12),
`followCenterY` (7), `followOverflowTile` ("black"),
`allowDismissRootMenu` (0), `sayAdvanceDelay` (0.2),
`textSpeed` (20), `textSkip` (1).

### `datetime` (read-only)
`year`, `year99`, `month`, `day`, `weekday`, `hour`, `hour12`,
`minute`, `second`, `ampm`, `timestamp`.

## Transpiler Notes

Decisions made by the Phase 2 transpiler / runtime:

* `tell <target> to ... end` becomes `pulp.tell('<target>', function() ... end)`.
  Inside, `pulp.event.tile_id` is swapped to the target; restored on exit.
* `call <name>` / `emit <name>` / `mimic <name>` accept a bare identifier or a
  double-quoted string — both are normalised to a string argument in Lua.
* `++` and `--` desugar to `+= 1` and `-= 1`.
* Strings with `{var}` placeholders compile to `pulp.fmt("...", {var=pulp.vars.var})`.
* `{n,c:var}` padding is implemented by `pulp.fmt`.
* `done` compiles to `do return end` in the surrounding handler.
* Numeric literals support integers and decimals (`0`, `1.5`, `-2`).
* All variable reads/writes go through the `pulp.vars` table so the JS
  interpreter (Agent E) can share live state with the runtime if desired.
