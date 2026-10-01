import { registry } from "@web/core/registry";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function press(key, options = {}) {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
    await pause(120);
    target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, ...options }));
    await pause(400);
}

/**
 * True once the grid shows Doom in colour: the title screen has a red sky,
 * green armour and blue horns, so all three must appear on the canvas.
 */
function gridShowsDoom() {
    const canvas = document.querySelector(".o-grid > canvas"); // the grid, not a chart figure
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const seen = { red: false, green: false, blue: false };
    for (let i = 0; i < data.length; i += 16) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        seen.red ||= r > 120 && g < 60 && b < 60;
        seen.green ||= g > 90 && g > r + 30 && g > b + 30;
        seen.blue ||= b > 90 && b > r + 40 && b > g + 40;
    }
    return seen.red && seen.green && seen.blue;
}

// Doom > Insert Doom Screen in a Documents spreadsheet, watch the title demo
// in the cells, Play, start E1M1 from the Doom menu, and hand the keyboard
// back. test_sheet_tour checks the saved revision.
registry.category("web_tour.tours").add("odoom_sheet", {
    steps: () => [
        {
            content: "Open the Doom menu",
            trigger: ".o-topbar-menu:contains(Doom)",
            run: "click",
        },
        {
            content: "Insert Doom Screen",
            trigger: ".o-menu-item:contains(Insert Doom Screen)",
            run: "click",
        },
        {
            content: "A1 holds the DOOM formula",
            trigger: ".o-spreadsheet-topbar:contains(=DOOM(120, 75))",
        },
        {
            content: "The engine paints the cells",
            trigger: ".o-grid canvas",
            async run() {
                for (let tries = 0; !gridShowsDoom(); tries++) {
                    if (tries > 100) {
                        throw new Error("The Doom screen never showed red, green and blue");
                    }
                    await pause(100);
                }
            },
        },
        {
            content: "Open the Doom menu again",
            trigger: ".o-topbar-menu:contains(Doom)",
            run: "click",
        },
        {
            content: "Play",
            trigger: ".o-menu-item:contains(Play):not(.disabled)",
            run: "click",
        },
        {
            content: "Play takes the keyboard: send Doom the new-game keys, then Shift+Esc",
            trigger: ".o_doom_sheet_banner",
            async run() {
                for (const key of ["Escape", "Enter", "Enter", "Enter"]) {
                    await press(key);
                }
                await pause(1500);
                await press("Escape", { shiftKey: true });
            },
        },
        {
            content: "Shift+Esc gave the keyboard back",
            trigger: "body:not(:has(.o_doom_sheet_banner))",
        },
    ],
});
