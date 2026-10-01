# How oDoom works

oDoom runs Doom inside an Odoo spreadsheet. There is no canvas or video
element: the picture is made of spreadsheet cells, one cell per pixel, and the
cells are real cells with real values. This is how it got there, including
the parts that did not work.

> **A note on content.** oDoom is a playful engineering experiment by the
> developers at UCS OneDo. Doom is a classic and a well-known test of what a
> platform can do; we picked it for that, not for its content. We don't
> condone violence.

## The pieces

```
doomgeneric (C)  --emscripten-->  doomgeneric.wasm  --frames-->  DOOM() in a cell
     ^                                   |                              |
  keys from the                    kills (C hook)                spilled colour
  spreadsheet                            v                       strings, drawn
                                  doom.kill records  -->  bar chart  by the grid
```

- **Engine.** [doomgeneric](https://github.com/ozkl/doomgeneric) is a
  Chocolate Doom derivative made for porting: the platform layer is a handful
  of functions (draw a frame, read a key, sleep, get the time). We compile it
  to WebAssembly with Emscripten and write our own platform layer
  (`odoom/tools/engine/doomgeneric_odoo.c`). It has no SDL and does not touch
  the browser itself. Frames go out to JavaScript as an RGBA buffer, keys come
  in through `doom_key()`, and Emscripten's main loop runs the game at Doom's
  35 tics per second.
- **Game data.** [Freedoom](https://freedoom.github.io/) Phase 1, a free
  replacement for the original game data. id Software's DOOM.WAD is not
  included.
- **The function.** `DOOM(columns, rows)` is an ordinary spreadsheet function,
  registered like `SUM`. It returns a matrix, so the result spills over
  `columns × rows` cells, the same way `SEQUENCE(10, 10)` does.
- **The kills.** A one-line hook in Doom's `P_KillMobj` tells JavaScript when
  the player kills a monster. The kills are batched and stored as `doom.kill`
  records, and a normal Odoo chart on the next sheet counts them.

## Making a spreadsheet a display

Doom draws 35 frames a second. A spreadsheet is built to recalculate when a
person edits something. The whole project is about closing that gap.

### Attempt 1: brightness and a colour scale (16 fps, grey)

The first version returned one number per cell, the pixel's brightness, and
let a conditional format colour scale turn the numbers into shades. It worked
at once and was a convincing proof: 80 × 50 cells at about 16 fps. But it was
monochrome, and every number went through the spreadsheet's number formatting
before it was drawn.

### Attempt 2: cell styles (2 to 5 fps)

For colour, the obvious move is to set each cell's fill colour. That was much
slower. A style change is an edit: it goes through the undo history and the
collaboration layer, which exist so that several people can edit one document
safely. Pushing thousands of edits per frame through that machinery is exactly
what it is not for.

### Attempt 3: colour strings as values (20 fps, full colour)

The version that shipped keeps everything in the values. `DOOM()` returns a
colour string per cell, `"#8b0001"`, and three things make that fast:

1. **Strings, not numbers.** The spreadsheet formats every evaluated number
   for display. A string needs no formatting. Doom uses a few hundred distinct
   colours, so the strings are built once and cached.
2. **Re-evaluate one cell, not the workbook.** When the engine has a new frame,
   only the `=DOOM()` cells are re-evaluated (`EVALUATE_CELLS` with their cell
   ids). This runs outside the undo and collaboration history, so playing adds
   no revisions to the document, and the rest of the workbook is untouched.
3. **Draw the value as a fill.** A small patch on the grid renderer
   (`odoom/static/src/spreadsheet/doom_render.js`) draws a cell inside a DOOM
   screen as a plain rectangle in the colour it holds. It skips conditional
   formats, borders, icons and text layout.

### The smear

The first colour version looked wrong in motion: the picture smeared, as if
every frame bled into the next. The cause was a nice feature of the grid: when
a cell's colour changes, it fades to the new colour over 200 ms. With a new
frame every 30 to 50 ms, every cell was always mid-fade. The renderer patch
turns that animation off for DOOM cells only.

### Numbers

Measured in headless Chromium without a GPU, 1600 × 900 window. The number of
cells sets the frame rate; their size barely matters.

| Screen | Cells | fps |
|---|---|---|
| `=DOOM(80, 50)` | 4,000 | ~31 |
| `=DOOM(120, 75)` (the default) | 9,000 | ~20 |
| `=DOOM(160, 100)` | 16,000 | ~15 |
| `=DOOM(320, 200)`, Doom's own resolution | 64,000 | ~5 |

What remains is the spreadsheet's own evaluation of the spilled values. A
first run of this table was wrong: the larger screens did not fit on the
sheet, so they drew nothing and looked fast. The sheet is now sized to the
screen before measuring.

## Keyboard and focus

The spreadsheet wants the arrow keys too. **Doom > Play** listens on the
window in the capture phase, so Doom gets a key before the grid moves the
selection, and keys are tracked by physical key so a release is never lost.
Keys are left alone while you type in a cell, the formula bar or a dialog.
**Shift+Esc** gives the keyboard back. The game pauses when the tab is hidden
or the window loses focus, and held keys are released then, so you never come
back to a player running into a wall.

## A screen's life

A DOOM screen exists only while its formula does. Each evaluation of `DOOM()`
registers its cells; before each frame those registrations are dropped and the
re-evaluation renews them. Delete the formula, wrap it in something that
discards it, or give it an invalid size, and the screen disappears with it.
When the last screen in the last open spreadsheet is gone, the engine stops.
The engine and the 28 MB game data are only fetched when a DOOM cell first
evaluates, so a spreadsheet without one costs nothing.

## Kills as data

The engine reports a kill when the player is the killer and the target counts
as a monster, plus the two that Doom's kill counter leaves out (Lost Souls
and the Icon of Sin). Kills are batched every five seconds into one call,
`doom.kill.record_kills`, which validates the monster names and stores them
for the current user. Then only the charts over `doom.kill` reload, not every
data source in the document.

So the chart next to the game is not special. It is the same Odoo chart you
would put over sales orders, and the kills are ordinary records with access
rules: everyone can read them, only administrators can change them.

## Engine changes

Our changes to Doom itself are small and kept as a patch
(`odoom/tools/engine/odoo_hooks.patch`):

- the kill hook in `P_KillMobj`;
- the screen melt between levels is turned off, because it busy-waits in a
  way a browser's animation loop cannot.

Everything else is the platform layer. `odoom/tools/build_engine.sh` rebuilds
the engine from pinned inputs (Emscripten image by digest, doomgeneric by
commit, Freedoom by SHA-256), and two builds produce identical files.

## Licensing

The module is GPL-3. Doom's source is GPL-2.0-or-later, but two of
doomgeneric's own files (`doomgeneric.c`, `dummy.c`) state no "or later". We
do not compile them and use our own platform layer instead, so the whole
engine is GPL-2.0-or-later and can ship inside a GPL-3 module. The Emscripten runtime is MIT, Freedoom is BSD-style. Details
in `odoom/static/lib/NOTICE`. "Doom" is a trademark of id Software; this
project is not affiliated with or endorsed by them.

## Limitations

No sound, no mouse, saves last only as long as the page, and the renderer
patch depends on o-spreadsheet internals, so an Odoo update can break it. It
is a fun experiment, not a product.
