# oDoom

Play Doom inside an Odoo 19 spreadsheet (Enterprise, Documents).

1. Open a spreadsheet in Documents.
2. **Doom > Insert Doom Screen** adds a "Doom" sheet: `=DOOM(120, 75)` in A1,
   cells sized to fill the window, and a live chart of your kills.
3. **Doom > Play** gives the keyboard to the game: arrows move, Ctrl fires,
   Space opens doors. **Shift+Esc** gives it back.

`=DOOM(columns, rows)` works in any cell, from 20 × 10 up to 320 × 200.
**Doom > Fit Screen to Window** re-fits the screen after a window change.

## How it works

- **Engine.** [doomgeneric](https://github.com/ozkl/doomgeneric) compiled to
  WebAssembly with a small platform layer (`tools/engine/`): no SDL, frames
  go out as RGBA, keys come in through `doom_key()`, the player's kills are
  reported to JavaScript. It plays [Freedoom](https://freedoom.github.io/) Phase 1. The
  engine and the 28 MB WAD are fetched only when a DOOM cell first evaluates.
- **The formula.** `DOOM()` downsamples the current frame and returns one
  colour string per cell (`"#8b0001"`), spilled over the range. Strings, not
  numbers: the spreadsheet formats every evaluated number for display, which
  dominated the cost of a large screen.
- **Repainting.** On each animation frame that brings a new engine frame, only
  the DOOM cells are re-evaluated (`EVALUATE_CELLS` with `cellIds`), outside
  the undo and collaboration history.
- **Drawing.** A patch on the grid renderer (`doom_render.js`) draws a DOOM
  cell as a plain fill in the colour it holds. It skips conditional formats,
  borders, icons, text layout and the grid's 200 ms colour-change animation,
  which would otherwise smear the frames.
- **Kills.** Kills made while playing are sent in batches to `doom.kill`
  (monster and map), always for the current user, and only the `doom.kill`
  charts reload. Everyone can read all kills (that is what the
  chart counts); only administrators edit or delete them.

Frame rates measured once, in headless Chromium (Playwright) without a GPU,
1600 × 900 window; your browser will differ. The cell count sets the rate,
not the cell size:

| Screen | fps |
|---|---|
| `=DOOM(80, 50)` | ~31 |
| `=DOOM(120, 75)` (Insert) | ~20 |
| `=DOOM(160, 100)` | ~15 |
| `=DOOM(320, 200)` | ~5 |

## Rebuilding the engine

The compiled engine and the WAD are committed, so installing needs no
toolchain. `tools/build_engine.sh` rebuilds them byte for byte from pinned
inputs (Emscripten image by digest, doomgeneric by commit, Freedoom by
SHA-256). It needs Docker, Git, curl, Python 3, sha256sum and network access.

## License

GPL-3 (`LICENSE`). The engine is doomgeneric (GPL-2.0-or-later) with our
changes in `tools/engine/`; Freedoom is under its own BSD-style license. See
`static/lib/NOTICE`. id Software's DOOM.WAD is not included.

## Limitations

- No sound, no mouse. Keyboard only.
- In-game saves last only as long as the page.
- The picture is a fraction of Doom's resolution by default.
