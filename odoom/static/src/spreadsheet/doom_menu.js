import { onMounted, onWillUnmount } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { user } from "@web/core/user";
import { patch } from "@web/core/utils/patch";
import { Spreadsheet, helpers, registries } from "@odoo/o-spreadsheet";
import { doomSheet } from "./doom_sheet";

const { topbarMenuRegistry } = registries;
const { UuidGenerator } = helpers;

// The cell count sets the frame rate (see README), the cell size barely does:
// keep 120 x 75 cells and size them to fill the window, chart included.
const COLUMNS = 120;
const ROWS = 75;
const CHART = { width: 420, height: 340, gap: 16 };
const MIN_CELL_PX = 3;
const MAX_CELL_PX = 16;

/** The cell size that fits the screen and the chart in the visible grid. */
export function fittedCellSize(model, columns = COLUMNS, rows = ROWS) {
    const { width, height } = model.getters.getSheetViewDimension();
    const px = Math.floor(
        Math.min((width - CHART.width - 2 * CHART.gap) / columns, (height - CHART.gap) / rows)
    );
    return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, px));
}

function sizeScreen(model, run, sheetId, columns, rows) {
    const px = fittedCellSize(model, columns, rows);
    run("RESIZE_COLUMNS_ROWS", { sheetId, dimension: "COL", elements: [...Array(columns).keys()], size: px });
    run("RESIZE_COLUMNS_ROWS", { sheetId, dimension: "ROW", elements: [...Array(rows).keys()], size: px });
}

function dispatcher(model, label) {
    return (type, payload) => {
        const result = model.dispatch(type, payload);
        if (!result.isSuccessful) {
            throw new Error(`${label}: ${type} failed (${result.reasons.join(", ")})`);
        }
    };
}

/**
 * Doom > Insert Doom Screen: a new "Doom" sheet with =DOOM() in A1 over
 * pixel-sized cells that fill the visible grid (the grid paints them in the
 * colours their values hold, see doom_render.js), and to their right a live
 * Odoo bar chart of the current user's kills per monster.
 */
export function insertDoomScreen(env) {
    const model = env.model;
    const uuid = new UuidGenerator();
    const sheetId = uuid.smallUuid();
    const chartId = uuid.smallUuid();
    const run = dispatcher(model, "Insert Doom Screen");
    run("CREATE_SHEET", {
        sheetId,
        name: model.getters.getSheetIdByName("Doom") ? undefined : "Doom",
        position: model.getters.getSheetIds().length,
        cols: COLUMNS + 6,
        rows: ROWS + 5,
    });
    run("ACTIVATE_SHEET", { sheetIdFrom: model.getters.getActiveSheetId(), sheetIdTo: sheetId });
    sizeScreen(model, run, sheetId, COLUMNS, ROWS);
    run("SET_GRID_LINES_VISIBILITY", { sheetId, areGridLinesVisible: false });
    run("UPDATE_CELL", { sheetId, col: 0, row: 0, content: `=DOOM(${COLUMNS}, ${ROWS})` });
    const domain = [["user_id", "=", user.userId]];
    run("CREATE_CHART", {
        sheetId,
        figureId: uuid.smallUuid(),
        chartId,
        col: COLUMNS,
        row: 0,
        offset: { x: CHART.gap, y: 0 },
        size: { width: CHART.width, height: CHART.height },
        definition: {
            type: "odoo_bar",
            id: chartId,
            dataSourceId: uuid.smallUuid(),
            title: { text: _t("My Doom kills, live") },
            metaData: { groupBy: ["monster_type"], measure: "__count", order: "DESC", resModel: "doom.kill" },
            searchParams: { comparison: null, context: {}, domain, groupBy: ["monster_type"], orderBy: [] },
            background: "#FFFFFF",
            legendPosition: "none",
            verticalAxisPosition: "left",
            stacked: false,
        },
    });
}

/** Doom > Fit Screen to Window: re-fit the active sheet's DOOM screens. */
export function fitDoomScreen(env) {
    const model = env.model;
    const sheetId = model.getters.getActiveSheetId();
    const run = dispatcher(model, "Fit Screen to Window");
    for (const screen of doomSheet.positions.get(model.getters)?.values() || []) {
        if (screen.sheetId !== sheetId) {
            continue;
        }
        const { zone } = screen;
        const columns = zone.right - zone.left + 1;
        const rows = zone.bottom - zone.top + 1;
        const px = fittedCellSize(model, columns, rows);
        run("RESIZE_COLUMNS_ROWS", {
            sheetId, dimension: "COL", elements: [...Array(columns).keys()].map((i) => zone.left + i), size: px,
        });
        run("RESIZE_COLUMNS_ROWS", {
            sheetId, dimension: "ROW", elements: [...Array(rows).keys()].map((i) => zone.top + i), size: px,
        });
    }
}

topbarMenuRegistry
    .add("doom", { name: _t("Doom"), sequence: 1000 })
    .addChild("doom_insert", ["doom"], {
        name: _t("Insert Doom Screen"),
        sequence: 10,
        execute: insertDoomScreen,
    })
    .addChild("doom_fit", ["doom"], {
        name: _t("Fit Screen to Window"),
        sequence: 15,
        execute: fitDoomScreen,
        isEnabled: (env) =>
            [...(doomSheet.positions.get(env.model.getters)?.values() || [])].some(
                (screen) => screen.sheetId === env.model.getters.getActiveSheetId()
            ),
    })
    .addChild("doom_play", ["doom"], {
        name: _t("Play"),
        sequence: 20,
        execute: () => doomSheet.startPlaying(),
        isVisible: () => !doomSheet.playing,
        isEnabled: () => Boolean(doomSheet.starting),
    })
    .addChild("doom_stop", ["doom"], {
        name: _t("Stop Playing (Shift+Esc)"),
        sequence: 30,
        execute: () => doomSheet.stopPlaying(),
        isVisible: () => doomSheet.playing,
    });

patch(Spreadsheet.prototype, {
    setup() {
        super.setup();
        const model = this.props.model;
        onMounted(() => doomSheet.attach(model));
        onWillUnmount(() => doomSheet.detach(model));
    },
});
