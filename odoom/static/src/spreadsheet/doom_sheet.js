import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { DoomEngine, doomKeyCode } from "@odoom/engine/doom_engine";
import { EventBatcher } from "@odoom/engine/event_batcher";

const WIDTH = 640;
const HEIGHT = 400;

// Doom draws with a few hundred distinct colours, so their "#rrggbb" strings
// are built once. Strings rather than numbers: the spreadsheet formats every
// evaluated number for display, which dominated the cost of a large screen.
const COLOURS = new Map();
function colourString(rgb) {
    let colour = COLOURS.get(rgb);
    if (!colour) {
        colour = "#" + rgb.toString(16).padStart(6, "0");
        COLOURS.set(rgb, colour);
    }
    return colour;
}
const BLACK = "#000000";

function recordKills(kills) {
    return rpc("/web/dataset/call_kw/doom.kill/record_kills", {
        model: "doom.kill",
        method: "record_kills",
        args: [kills],
        kwargs: {},
    });
}

/** Keys belong to whatever the user is typing in, never to Doom. */
function isTyping(target) {
    if (target.matches?.("input, textarea, select")) {
        return true;
    }
    // The grid keeps a hidden editor focused at all times; it only takes keys
    // while a cell is being edited ("active"). Any other editor (formula bar,
    // chatter, dialogs) always does.
    return Boolean(
        target.isContentEditable && (!target.closest(".o-grid") || target.classList.contains("active"))
    );
}

/**
 * Shares one engine across the open spreadsheets and re-evaluates their DOOM
 * cells when the engine draws a new frame. In Play mode the keyboard goes to
 * the game, and the player's kills are sent to doom.kill in batches.
 */
export class DoomSheet {
    constructor() {
        this.pixels = null;
        this.frame = 0;
        this.engine = null;
        this.starting = null;
        this.models = new Map(); // open spreadsheet model -> last frame it was evaluated for
        // DOOM cells per spreadsheet, keyed by the model's getters: that is what
        // a function sees while evaluating, possibly before the sheet is mounted.
        this.positions = new WeakMap();
        this.generation = 0; // bumped by shutdown(), so late engine starts know
        this.playing = false;
        this.heldKeys = new Map(); // KeyboardEvent.code -> Doom key code
        this.batcher = new EventBatcher((kills) => this.sendKills(kills));
        this.banner = null;
        this.onKeyDown = (ev) => this.forwardKey(ev, true);
        this.onKeyUp = (ev) => this.forwardKey(ev, false);
        this.onBlur = () => {
            this.releaseKeys();
            this.applyPause();
        };
        this.onFocus = () => this.applyPause();
        this.onVisibilityChange = () => this.applyPause();
    }

    // --- the function side -------------------------------------------------

    /**
     * Called by DOOM() while evaluating: remembers the cell and the size of
     * its spill, and boots the engine.
     */
    request(getters, sheetId, position, cols, rows) {
        if (!this.positions.has(getters)) {
            this.positions.set(getters, new Map());
        }
        this.positions.get(getters).set(`${sheetId}:${position.col}:${position.row}`, {
            sheetId,
            ...position,
            zone: {
                left: position.col,
                top: position.row,
                right: position.col + cols - 1,
                bottom: position.row + rows - 1,
            },
        });
        this.ensureEngine();
    }

    /** True when the cell lies in a DOOM screen of that spreadsheet. */
    isPixel(getters, sheetId, col, row) {
        const positions = this.positions.get(getters);
        if (!positions) {
            return false;
        }
        for (const { sheetId: screenSheetId, zone } of positions.values()) {
            if (
                screenSheetId === sheetId &&
                col >= zone.left && col <= zone.right && row >= zone.top && row <= zone.bottom
            ) {
                return true;
            }
        }
        return false;
    }

    /** The current frame as [col][row] colours ("#rrggbb"), downsampled. */
    matrix(cols, rows) {
        const matrix = [];
        const p = this.pixels;
        for (let c = 0; c < cols; c++) {
            const column = new Array(rows);
            const x = Math.floor((c * WIDTH) / cols);
            for (let r = 0; r < rows; r++) {
                if (!p) {
                    column[r] = { value: BLACK };
                    continue;
                }
                const i = (Math.floor((r * HEIGHT) / rows) * WIDTH + x) * 4;
                column[r] = { value: colourString((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]) };
            }
            matrix.push(column);
        }
        return matrix;
    }

    // --- spreadsheets ------------------------------------------------------

    attach(model) {
        this.models.set(model, -1);
    }

    detach(model) {
        this.models.delete(model);
        if (!this.models.size) {
            this.shutdown();
        }
    }

    /**
     * Re-evaluates the DOOM cells of every attached spreadsheet, once per new
     * frame. Registrations are dropped first: DOOM() renews its own while
     * evaluating, so a cell that no longer draws a valid screen falls out.
     */
    tick() {
        this.raf = requestAnimationFrame(() => this.tick());
        let dropped = false;
        for (const [model, frame] of this.models) {
            const positions = this.positions.get(model.getters);
            if (frame === this.frame || !positions?.size) {
                continue;
            }
            this.models.set(model, this.frame);
            const cellIds = [...positions.values()]
                .map((position) => model.getters.getCell(position))
                .filter((cell) => cell?.isFormula)
                .map((cell) => cell.id);
            const before = positions.size;
            positions.clear();
            if (cellIds.length) {
                model.dispatch("EVALUATE_CELLS", { cellIds });
            }
            dropped ||= positions.size < before;
        }
        const screensLeft = [...this.models.keys()].some((model) => this.positions.get(model.getters)?.size);
        if (dropped && !screensLeft) {
            this.shutdown();
        }
    }

    ensureEngine() {
        if (!this.starting) {
            const generation = this.generation;
            this.starting = DoomEngine.start(this.hooks()).then(
                (engine) => {
                    if (generation !== this.generation) {
                        engine.stop(); // every spreadsheet closed while it loaded
                        return;
                    }
                    this.engine = engine;
                    document.addEventListener("visibilitychange", this.onVisibilityChange);
                    this.tick();
                    this.notify();
                    this.applyPause();
                },
                (error) => {
                    if (generation === this.generation) {
                        this.starting = null; // the next request tries again
                    }
                    throw error;
                }
            );
        }
        return this.starting;
    }

    shutdown() {
        this.generation++;
        this.stopPlaying();
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        cancelAnimationFrame(this.raf);
        this.engine?.stop();
        this.engine = null;
        this.starting = null;
        this.pixels = null;
    }

    hooks() {
        return {
            drawFrame: (pixels) => {
                this.pixels = pixels.slice();
                this.frame++;
            },
            onKill: (monster, map) => {
                if (this.playing) {
                    this.batcher.push({ monster, map });
                }
            },
        };
    }

    // --- play mode ---------------------------------------------------------

    async startPlaying() {
        const generation = this.generation;
        await this.ensureEngine();
        if (this.playing || generation !== this.generation) {
            return; // a second click, or the spreadsheet closed meanwhile
        }
        this.batcher.start();
        this.playing = true;
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("keyup", this.onKeyUp, true);
        window.addEventListener("blur", this.onBlur);
        window.addEventListener("focus", this.onFocus);
        this.notify();
        this.applyPause();
    }

    stopPlaying() {
        if (!this.playing) {
            return;
        }
        this.playing = false;
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("keyup", this.onKeyUp, true);
        window.removeEventListener("blur", this.onBlur);
        window.removeEventListener("focus", this.onFocus);
        this.releaseKeys();
        this.batcher.stop();
        this.batcher.flush();
        this.notify();
        this.applyPause();
    }

    forwardKey(ev, pressed) {
        if (pressed && ev.key === "Escape" && ev.shiftKey) {
            ev.preventDefault();
            ev.stopPropagation();
            this.stopPlaying();
            return;
        }
        // A release always follows its press, wherever the focus went meanwhile.
        const held = this.heldKeys.get(ev.code);
        if (!pressed) {
            if (held !== undefined) {
                ev.preventDefault();
                ev.stopPropagation();
                this.heldKeys.delete(ev.code);
                this.engine.key(false, held);
            }
            return;
        }
        const code = doomKeyCode(ev.key, ev.code);
        if (code === null || isTyping(ev.target)) {
            return;
        }
        // Capture phase: the grid never sees the key, so the selection stays put.
        ev.preventDefault();
        ev.stopPropagation();
        if (held === undefined) {
            this.heldKeys.set(ev.code, code); // otherwise an auto-repeat
            this.engine.key(true, code);
        }
    }

    /**
     * Hidden tab: always paused. Playing: also paused while the window is not
     * focused, so the game waits for the player. The title demo keeps running
     * in a visible, unfocused window: that is what it is for.
     */
    applyPause() {
        const paused = document.hidden || (this.playing && !document.hasFocus());
        this.engine?.pause(paused);
        if (paused) {
            this.batcher.flush();
        }
    }

    releaseKeys() {
        for (const code of this.heldKeys.values()) {
            this.engine?.key(false, code);
        }
        this.heldKeys.clear();
    }

    async sendKills(kills) {
        await recordKills(kills);
        for (const model of this.models.keys()) {
            this.reloadKillCharts(model);
        }
    }

    reloadKillCharts(model) {
        for (const chartId of model.getters.getOdooChartIds()) {
            if (model.getters.getChartDefinition(chartId).metaData.resModel === "doom.kill") {
                model.getters.getChartDataSource(chartId).load({ reload: true });
            }
        }
    }

    /** The "Playing" banner: visible exactly while the keyboard belongs to Doom. */
    notify() {
        if (this.playing && !this.banner) {
            // Bottom right, clear of the screen and of the kills chart above it.
            this.banner = document.createElement("div");
            this.banner.className =
                "o_doom_sheet_banner position-fixed bottom-0 end-0 mb-5 me-4 p-3 " +
                "rounded-3 text-bg-danger shadow";
            const title = document.createElement("div");
            title.className = "fs-5 fw-bold";
            title.textContent = _t("Playing Doom");
            const help = document.createElement("div");
            help.textContent = _t("Arrows move, Ctrl fires, Space opens doors.");
            const exit = document.createElement("div");
            exit.textContent = _t("Shift+Esc gives the keyboard back.");
            this.banner.append(title, help, exit);
            document.body.append(this.banner);
        } else if (!this.playing && this.banner) {
            this.banner.remove();
            this.banner = null;
        }
    }
}

export const doomSheet = new DoomSheet();
