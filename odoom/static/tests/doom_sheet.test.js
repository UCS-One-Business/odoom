import { after, describe, expect, getFixture, test } from "@odoo/hoot";
import { Deferred } from "@odoo/hoot-mock";
import { SpreadsheetModels } from "@spreadsheet/../tests/helpers/data";
import { createModelWithDataSource } from "@spreadsheet/../tests/helpers/model";
import { setCellContent } from "@spreadsheet/../tests/helpers/commands";
import { getCellContent, getCellValue, getEvaluatedCell } from "@spreadsheet/../tests/helpers/getters";
import { defineModels, fields, models, patchWithCleanup } from "@web/../tests/web_test_helpers";
import { DoomEngine } from "@odoom/engine/doom_engine";
import { doomSheet } from "@odoom/spreadsheet/doom_sheet";
import { fitDoomScreen, fittedCellSize, insertDoomScreen } from "@odoom/spreadsheet/doom_menu";
import { pixelBox } from "@odoom/spreadsheet/doom_render";

describe.current.tags("headless");

class DoomKill extends models.Model {
    _name = "doom.kill";
    monster_type = fields.Selection({ selection: [["imp", "Imp"], ["demon", "Demon"]] });
    user_id = fields.Many2one({ relation: "res.users" });
    _records = [{ id: 1, monster_type: "imp", user_id: 7 }];
}
defineModels({ ...SpreadsheetModels, DoomKill });

/** A 640 x 400 white frame whose top-left 32 x 40 pixels are pure red. */
function fakeFrame() {
    const pixels = new Uint8ClampedArray(640 * 400 * 4).fill(255);
    for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 32; x++) {
            const i = (y * 640 + x) * 4;
            pixels[i + 1] = 0;
            pixels[i + 2] = 0;
        }
    }
    return pixels;
}

function useFakeEngine() {
    const calls = [];
    patchWithCleanup(doomSheet, {
        ensureEngine() {},
        engine: {
            key: (pressed, code) => calls.push(["key", pressed, code]),
            pause: (paused) => calls.push(["pause", paused]),
            stop: () => calls.push(["stop"]),
        },
    });
    doomSheet.pixels = fakeFrame();
    after(() => {
        doomSheet.pixels = null;
        doomSheet.playing = false;
        doomSheet.heldKeys.clear();
    });
    return calls;
}

function keyEvent(key, target, code = key) {
    return { key, code, target, shiftKey: false, preventDefault() {}, stopPropagation() {} };
}

test("DOOM spills the frame as one colour per cell", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    setCellContent(model, "A1", "=DOOM(20, 10)");
    expect(getCellValue(model, "A1")).toBe("#ff0000");
    expect(getCellValue(model, "B2")).toBe("#ffffff");
    expect(getCellValue(model, "T10")).toBe("#ffffff");
    expect(getCellValue(model, "U1")).toBe(null);
    expect(getCellValue(model, "A11")).toBe(null);
});

test("DOOM is black until the engine draws", async () => {
    patchWithCleanup(doomSheet, { ensureEngine() {} });
    const { model } = await createModelWithDataSource();
    setCellContent(model, "A1", "=DOOM(20, 10)");
    expect(getCellValue(model, "T10")).toBe("#000000");
});

test("DOOM refuses screens it cannot draw", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    setCellContent(model, "A1", "=DOOM(5, 10)");
    expect(getEvaluatedCell(model, "A1").message).toBe("DOOM needs 20 to 320 columns and 10 to 200 rows.");
});

test("DOOM cells register their screen for re-evaluation and painting", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    setCellContent(model, "C3", "=DOOM(20, 10)");
    const sheetId = model.getters.getActiveSheetId();
    const [screen] = doomSheet.positions.get(model.getters).values();
    expect(screen.zone).toEqual({ left: 2, top: 2, right: 21, bottom: 11 });
    expect(doomSheet.isPixel(model.getters, sheetId, 21, 11)).toBe(true);
    expect(doomSheet.isPixel(model.getters, sheetId, 22, 11)).toBe(false);
    expect(doomSheet.isPixel(model.getters, "other sheet", 2, 2)).toBe(false);
});

test("the grid paints a pixel in the colour its cell holds, without animation", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    setCellContent(model, "A1", "=DOOM(20, 10)");
    setCellContent(model, "Z1", "#00ff00"); // a colour outside the screen is just text
    const sheetId = model.getters.getActiveSheetId();
    const box = pixelBox(model.getters, sheetId, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(box.style).toEqual({ fillColor: "#ff0000" });
    expect(box.disabledAnimation).toBe(true);
    expect(box.content).toBe(undefined);
    expect(pixelBox(model.getters, sheetId, { left: 25, right: 25, top: 0, bottom: 0 })).toBe(null);
    expect(pixelBox(model.getters, sheetId, { left: 0, right: 1, top: 0, bottom: 0 })).toBe(null);
});

test("while playing, keys go to Doom unless the user is typing", async () => {
    const calls = useFakeEngine();
    doomSheet.playing = true;
    const fixture = getFixture();
    fixture.innerHTML = `
        <input class="search"/>
        <div class="o-spreadsheet-topbar"><div class="formula-bar" contenteditable="true"></div></div>
        <div class="o-grid"><div class="grid-editor" contenteditable="true"></div></div>`;
    const gridEditor = fixture.querySelector(".grid-editor");
    doomSheet.forwardKey(keyEvent("ArrowUp", gridEditor), true);
    doomSheet.forwardKey(keyEvent("ArrowUp", gridEditor), false);
    expect(calls).toEqual([["key", true, 0xad], ["key", false, 0xad]]);

    calls.length = 0;
    doomSheet.forwardKey(keyEvent("a", fixture.querySelector(".search")), true);
    doomSheet.forwardKey(keyEvent("a", fixture.querySelector(".formula-bar")), true);
    gridEditor.classList.add("active"); // editing a cell
    doomSheet.forwardKey(keyEvent("a", gridEditor), true);
    expect(calls).toEqual([]);
});

test("kills are recorded only while playing", async () => {
    useFakeEngine();
    after(() => doomSheet.batcher.queue.splice(0));
    const { onKill } = doomSheet.hooks();
    onKill("imp", "E1M1"); // the title demo, or a game left running
    expect(doomSheet.batcher.queue).toHaveLength(0);
    doomSheet.playing = true;
    onKill("imp", "E1M1");
    expect(doomSheet.batcher.queue.map(({ monster, map }) => [monster, map])).toEqual([["imp", "E1M1"]]);
});

test("playing pauses when the window loses focus; the title demo does not", async () => {
    const calls = useFakeEngine();
    patchWithCleanup(document, { hasFocus: () => false });
    doomSheet.applyPause();
    doomSheet.playing = true;
    doomSheet.applyPause();
    expect(calls).toEqual([["pause", false], ["pause", true]]);
});

test("Insert Doom Screen fills the visible grid and adds a live kills chart", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    model.dispatch("RESIZE_SHEETVIEW", { width: 1537, height: 708, gridOffsetX: 48, gridOffsetY: 26 });
    insertDoomScreen({ model });
    const sheetId = model.getters.getActiveSheetId();
    expect(model.getters.getSheetName(sheetId)).toBe("Doom");
    expect(getCellContent(model, "A1")).toBe("=DOOM(120, 75)");
    // (1537 - 420 - 32) / 120 = 9.04 and (708 - 16) / 75 = 9.2: 9 px cells.
    expect(model.getters.getColSize(sheetId, 119)).toBe(9);
    expect(model.getters.getRowSize(sheetId, 74)).toBe(9);
    expect(model.getters.getGridLinesVisibility(sheetId)).toBe(false);
    expect(getCellValue(model, "DP75")).toBe("#ffffff");
    const [chartId] = model.getters.getChartIds(sheetId);
    const chart = model.getters.getChartDefinition(chartId);
    expect(chart.type).toBe("odoo_bar");
    expect(chart.metaData.resModel).toBe("doom.kill");
    expect(chart.metaData.groupBy).toEqual(["monster_type"]);
    const [figure] = model.getters.getFigures(sheetId);
    expect([figure.col, figure.row]).toEqual([120, 0]); // right of the screen
});

test("Fit Screen to Window re-fits the screen to a new window size", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    model.dispatch("RESIZE_SHEETVIEW", { width: 1537, height: 708, gridOffsetX: 48, gridOffsetY: 26 });
    insertDoomScreen({ model });
    const sheetId = model.getters.getActiveSheetId();
    model.dispatch("RESIZE_SHEETVIEW", { width: 1100, height: 500, gridOffsetX: 48, gridOffsetY: 26 });
    fitDoomScreen({ model });
    // (1100 - 452) / 120 = 5.4 and (500 - 16) / 75 = 6.45: 5 px cells.
    expect(model.getters.getColSize(sheetId, 0)).toBe(5);
    expect(model.getters.getRowSize(sheetId, 74)).toBe(5);
    expect(fittedCellSize(model)).toBe(5);
});

test("a key released over a text field still releases in the game", async () => {
    const calls = useFakeEngine();
    doomSheet.playing = true;
    getFixture().innerHTML = `<div class="o-grid"><div class="grid-editor" contenteditable="true"></div></div><input/>`;
    doomSheet.forwardKey(keyEvent("ArrowUp", getFixture().querySelector(".grid-editor")), true);
    doomSheet.forwardKey(keyEvent("ArrowUp", getFixture().querySelector("input")), false);
    expect(calls).toEqual([["key", true, 0xad], ["key", false, 0xad]]);
});

test("strafing follows the physical key, so Shift+comma still strafes", async () => {
    const calls = useFakeEngine();
    doomSheet.playing = true;
    const grid = getFixture();
    doomSheet.forwardKey(keyEvent("<", grid, "Comma"), true);
    doomSheet.forwardKey(keyEvent(",", grid, "Comma"), false);
    expect(calls).toEqual([["key", true, 0xa0], ["key", false, 0xa0]]);
});

test("an engine that finishes loading after the spreadsheet closed is stopped", async () => {
    const loading = new Deferred();
    const stops = [];
    patchWithCleanup(DoomEngine, { start: () => loading });
    patchWithCleanup(doomSheet, { engine: null, starting: null });
    const started = doomSheet.ensureEngine();
    doomSheet.shutdown(); // the last spreadsheet closed
    loading.resolve({ stop: () => stops.push("stop") });
    await started;
    expect(stops).toEqual(["stop"]);
    expect(doomSheet.engine).toBe(null);
});

test("a failed engine load can be retried", async () => {
    const attempts = [];
    patchWithCleanup(DoomEngine, {
        start: () => {
            attempts.push("start");
            return Promise.reject(new Error("WAD download failed"));
        },
    });
    patchWithCleanup(doomSheet, { engine: null, starting: null });
    await expect(doomSheet.ensureEngine()).rejects.toThrow("WAD download failed");
    await expect(doomSheet.ensureEngine()).rejects.toThrow("WAD download failed");
    expect(attempts).toEqual(["start", "start"]);
});

test("a DOOM call wrapped in another formula keeps drawing new frames", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    doomSheet.attach(model);
    after(() => doomSheet.detach(model));
    setCellContent(model, "A1", '=IF(TRUE, DOOM(20, 10), "")');
    expect(getCellValue(model, "A1")).toBe("#ff0000");
    doomSheet.pixels = new Uint8ClampedArray(640 * 400 * 4).fill(0).map((_, i) => (i % 4 === 2 ? 255 : 0));
    doomSheet.frame++;
    doomSheet.tick();
    cancelAnimationFrame(doomSheet.raf);
    expect(getCellValue(model, "A1")).toBe("#0000ff");
});

for (const [name, content] of [
    ["replaced by text that mentions DOOM", '="DOOM("'],
    ["given a size it cannot draw", "=DOOM(5, 10)"],
]) {
    test(`a screen ${name} stops playing and the engine`, async () => {
        const calls = useFakeEngine();
        const { model } = await createModelWithDataSource();
        doomSheet.attach(model);
        after(() => doomSheet.detach(model));
        setCellContent(model, "A1", "=DOOM(20, 10)");
        doomSheet.playing = true;
        setCellContent(model, "A1", content);
        doomSheet.frame++;
        doomSheet.tick();
        cancelAnimationFrame(doomSheet.raf);
        expect(calls.some(([call]) => call === "stop")).toBe(true);
        expect(doomSheet.playing).toBe(false);
        expect(doomSheet.engine).toBe(null);
    });
}

test("a kill batch reloads the doom.kill charts only", async () => {
    useFakeEngine();
    const { model } = await createModelWithDataSource();
    insertDoomScreen({ model });
    const [killChart] = model.getters.getOdooChartIds();
    const reloads = [];
    patchWithCleanup(model.getters, {
        getOdooChartIds: () => [killChart, "partner_chart"],
        getChartDefinition: (id) => ({ metaData: { resModel: id === killChart ? "doom.kill" : "res.partner" } }),
        getChartDataSource: (id) => ({ load: () => reloads.push(id) }),
    });
    doomSheet.reloadKillCharts(model);
    expect(reloads).toEqual([killChart]);
});
