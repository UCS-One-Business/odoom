import { loadJS } from "@web/core/assets";

// Everything under static/lib is fetched only when a DOOM cell first evaluates;
// none of it is part of any asset bundle.
const LIB = "/odoom/static/lib";
const IWAD = "freedoom1.wad";

// Browser key -> doomgeneric key code (doomkeys.h in doomgeneric). Keys not
// listed here are sent as their lowercase character (weapons 1-7, y/n
// prompts, cheats, savegame names).
const SPECIAL_KEYS = {
    ArrowLeft: 0xac,
    ArrowRight: 0xae,
    ArrowUp: 0xad,
    ArrowDown: 0xaf,
    Control: 0xa3, // fire
    " ": 0xa2, // use
    Shift: 0x80 + 0x36, // run
    Alt: 0x80 + 0x38, // strafe modifier
    Enter: 13,
    Escape: 27,
    Tab: 9,
    Backspace: 0x7f,
    Pause: 0xff,
    "-": 0x2d,
    "=": 0x3d,
    "+": 0x3d,
    F1: 0x80 + 0x3b,
    F2: 0x80 + 0x3c,
    F3: 0x80 + 0x3d,
    F4: 0x80 + 0x3e,
    F5: 0x80 + 0x3f,
    F6: 0x80 + 0x40,
    F7: 0x80 + 0x41,
    F8: 0x80 + 0x42,
    F9: 0x80 + 0x43,
    F10: 0x80 + 0x44,
    F11: 0x80 + 0x57,
    F12: 0x80 + 0x58,
};

// Strafing follows the physical keys, so Shift (run) + comma still strafes
// whatever character the layout makes of it.
const PHYSICAL_KEYS = { Comma: 0xa0, Period: 0xa1 };

export function doomKeyCode(key, code) {
    if (code in PHYSICAL_KEYS) {
        return PHYSICAL_KEYS[code];
    }
    if (key in SPECIAL_KEYS) {
        return SPECIAL_KEYS[key];
    }
    if (key.length === 1 && key.charCodeAt(0) < 128) {
        return key.toLowerCase().charCodeAt(0);
    }
    return null;
}

/** One running engine instance; `hooks` receives drawFrame and onKill. */
export class DoomEngine {
    static async start(hooks) {
        const [, wad] = await Promise.all([
            loadJS(`${LIB}/doomgeneric/doomgeneric.js`),
            fetch(`${LIB}/freedoom/${IWAD}`).then((response) => {
                if (!response.ok) {
                    throw new Error(`Could not load ${IWAD}: HTTP ${response.status}`);
                }
                return response.arrayBuffer();
            }),
        ]);
        const module = await window.createDoomEngine({
            doomHooks: hooks,
            locateFile: (path) => `${LIB}/doomgeneric/${path}`,
        });
        module.FS.writeFile(`/${IWAD}`, new Uint8Array(wad));
        module.callMain(["-iwad", `/${IWAD}`]);
        return new DoomEngine(module);
    }

    constructor(module) {
        this.module = module;
    }

    key(pressed, code) {
        this.module._doom_key(pressed ? 1 : 0, code);
    }

    pause(paused) {
        this.module._doom_pause(paused ? 1 : 0);
    }

    stop() {
        this.module._doom_stop();
    }
}
