import { _t } from "@web/core/l10n/translation";
import { helpers, registries, EvaluationError } from "@odoo/o-spreadsheet";
import { doomSheet } from "./doom_sheet";

const { arg, toNumber } = helpers;

/**
 * =DOOM(columns, rows) spills Doom's current frame over columns x rows cells,
 * one colour per cell ("#8b0001"). The grid paints each of those cells in the
 * colour it holds (doom_render.js); Doom > Insert Doom Screen sizes the cells
 * into pixels.
 */
export const DOOM = {
    description: _t("Doom's current frame, one colour (#rrggbb) per cell."),
    args: [
        arg("columns (number, optional, default=80)", _t("Width of the screen in cells (20 to 320).")),
        arg("rows (number, optional, default=50)", _t("Height of the screen in cells (10 to 200).")),
    ],
    category: "Odoo",
    compute: function (columns = { value: 80 }, rows = { value: 50 }) {
        const cols = Math.trunc(toNumber(columns, this.locale));
        const lines = Math.trunc(toNumber(rows, this.locale));
        if (cols < 20 || cols > 320 || lines < 10 || lines > 200) {
            return new EvaluationError(_t("DOOM needs 20 to 320 columns and 10 to 200 rows."));
        }
        if (this.__originCellPosition) {
            doomSheet.request(this.getters, this.__originSheetId, this.__originCellPosition, cols, lines);
        }
        return doomSheet.matrix(cols, lines);
    },
    isExported: false,
};

registries.functionRegistry.add("DOOM", DOOM);
