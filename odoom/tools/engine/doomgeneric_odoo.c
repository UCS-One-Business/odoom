// Copyright (C) 2026 UCS OneDo AB
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// doomgeneric platform layer for the odoom Odoo module.
//
// No SDL: frames are passed to the spreadsheet as RGBA, keys arrive through
// doom_key(), and the player's kills leave through Module.doomHooks.onKill.
// Nothing here listens to the browser, so the engine never captures the
// keyboard on its own.
//
// It also replaces doomgeneric's doomgeneric.c and dummy.c, which carry no
// "or later" notice; with them out of the build, every compiled .c file is
// GPL-2.0-or-later.

#include <emscripten.h>
#include <stdio.h>

#include "doomgeneric.h"
#include "doomstat.h"
#include "m_argv.h"
#include "net_client.h"
#include "p_local.h"
#include "odoo_hooks.h"

#define KEYQUEUE_SIZE 64

static unsigned short key_queue[KEYQUEUE_SIZE];
static unsigned int key_write;
static unsigned int key_read;
static uint32_t rgba[DOOMGENERIC_RESX * DOOMGENERIC_RESY];
static char map_name[8];

EM_JS(void, js_draw_frame, (const uint32_t *pixels, int width, int height), {
    Module.doomHooks.drawFrame(HEAPU8.subarray(pixels, pixels + width * height * 4), width, height);
});

EM_JS(void, js_on_kill, (const char *monster, const char *map), {
    Module.doomHooks.onKill(UTF8ToString(monster), UTF8ToString(map));
});

static const char *MapName(void)
{
    if (gamemode == commercial)
        snprintf(map_name, sizeof(map_name), "MAP%02d", gamemap);
    else
        snprintf(map_name, sizeof(map_name), "E%dM%d", gameepisode, gamemap);
    return map_name;
}

// Keys match the doom.kill monster selection. An unknown type is passed
// through as "unknown" so the server rejects it loudly.
static const char *MobjKey(mobjtype_t type)
{
    switch (type)
    {
    case MT_POSSESSED: return "zombieman";
    case MT_SHOTGUY: return "shotgun_guy";
    case MT_VILE: return "archvile";
    case MT_UNDEAD: return "revenant";
    case MT_FATSO: return "mancubus";
    case MT_CHAINGUY: return "heavy_weapon_dude";
    case MT_TROOP: return "imp";
    case MT_SERGEANT: return "demon";
    case MT_SHADOWS: return "spectre";
    case MT_HEAD: return "cacodemon";
    case MT_BRUISER: return "baron";
    case MT_KNIGHT: return "hell_knight";
    case MT_SKULL: return "lost_soul";
    case MT_SPIDER: return "spider_mastermind";
    case MT_BABY: return "arachnotron";
    case MT_CYBORG: return "cyberdemon";
    case MT_PAIN: return "pain_elemental";
    case MT_WOLFSS: return "wolfenstein_ss";
    case MT_KEEN: return "commander_keen";
    case MT_BOSSBRAIN: return "icon_of_sin";
    default: return "unknown";
    }
}

// Title-screen demos play real levels; none of that is the user's game.
static boolean Reporting(void)
{
    return usergame && !demoplayback;
}

// Lost Souls and the Icon of Sin lack MF_COUNTKILL (Doom leaves them out of
// the intermission kill percentage), but killing them is still a kill.
static boolean IsMonster(mobj_t *mobj)
{
    return (mobj->flags & MF_COUNTKILL) || mobj->type == MT_SKULL || mobj->type == MT_BOSSBRAIN;
}

void Odoo_OnKill(mobj_t *source, mobj_t *target)
{
    if (Reporting() && source && source->player && IsMonster(target))
        js_on_kill(MobjKey(target->type), MapName());
}

// --- engine startup (instead of doomgeneric.c and dummy.c) --------------

pixel_t *DG_ScreenBuffer = NULL;

// Single player only: no network game, never a drone.
boolean net_client_connected = false;
boolean drone = false;

void M_FindResponseFile(void);
void D_DoomMain(void);

void doomgeneric_Create(int argc, char **argv)
{
    myargc = argc;
    myargv = argv;
    M_FindResponseFile();
    DG_ScreenBuffer = malloc(DOOMGENERIC_RESX * DOOMGENERIC_RESY * sizeof(pixel_t));
    DG_Init();
    D_DoomMain();
}

// --- doomgeneric platform functions -------------------------------------

void DG_Init(void)
{
}

void DG_DrawFrame(void)
{
    // DG_ScreenBuffer is 0x00RRGGBB; canvas ImageData wants R,G,B,A bytes.
    for (int i = 0; i < DOOMGENERIC_RESX * DOOMGENERIC_RESY; i++)
    {
        uint32_t p = DG_ScreenBuffer[i];
        rgba[i] = 0xFF000000u | ((p & 0xFFu) << 16) | (p & 0xFF00u) | ((p >> 16) & 0xFFu);
    }
    js_draw_frame(rgba, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

void DG_SleepMs(uint32_t ms)
{
    // The browser main loop cannot block; the engine only sleeps while it
    // waits for the next tic, which the 35 Hz main loop already paces.
}

uint32_t DG_GetTicksMs(void)
{
    return (uint32_t)emscripten_get_now();
}

int DG_GetKey(int *pressed, unsigned char *doomKey)
{
    if (key_read == key_write)
        return 0;
    unsigned short data = key_queue[key_read];
    key_read = (key_read + 1) % KEYQUEUE_SIZE;
    *pressed = data >> 8;
    *doomKey = data & 0xFF;
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
}

// --- API called from JavaScript -----------------------------------------

EMSCRIPTEN_KEEPALIVE void doom_key(int pressed, int key)
{
    key_queue[key_write] = (unsigned short)((pressed ? 1 : 0) << 8 | (key & 0xFF));
    key_write = (key_write + 1) % KEYQUEUE_SIZE;
}

EMSCRIPTEN_KEEPALIVE void doom_pause(int pause)
{
    if (pause)
        emscripten_pause_main_loop();
    else
        emscripten_resume_main_loop();
}

EMSCRIPTEN_KEEPALIVE void doom_stop(void)
{
    emscripten_cancel_main_loop();
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);
    emscripten_set_main_loop(doomgeneric_Tick, TICRATE, 0);
    return 0;
}
