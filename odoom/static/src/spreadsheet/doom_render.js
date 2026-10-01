import { helpers, stores } from "@odoo/o-spreadsheet";
import { patch } from "@web/core/utils/patch";
import { doomSheet } from "./doom_sheet";

const { toXC } = helpers;
const COLOUR = /^#[0-9a-f]{6}$/;

/**
 * The box the grid draws for a DOOM() pixel, or null for any other cell. The
 * cell holds its colour ("#8b0001") and that is its fill. Everything else the
 * renderer does per cell (conditional formats, borders, icons, text layout,
 * and the 200 ms colour-change animation, which would smear the frames) is
 * skipped, which was most of the cost of redrawing the screen on every frame.
 */
export function pixelBox(getters, sheetId, zone) {
    if (
        zone.left !== zone.right ||
        zone.top !== zone.bottom ||
        !doomSheet.isPixel(getters, sheetId, zone.left, zone.top)
    ) {
        return null;
    }
    const { value } = getters.getEvaluatedCell({ sheetId, col: zone.left, row: zone.top });
    if (typeof value !== "string" || !COLOUR.test(value)) {
        return null;
    }
    return {
        id: toXC(zone.left, zone.top),
        ...getters.getRect(zone),
        style: { fillColor: value },
        icons: {},
        isError: false,
        disabledAnimation: true,
    };
}

patch(stores.GridRenderer.prototype, {
    createZoneBox(sheetId, zone, viewport) {
        return pixelBox(this.getters, sheetId, zone) || super.createZoneBox(sheetId, zone, viewport);
    },
});
