#!/usr/bin/env bash
# Rebuild the committed engine assets under static/lib/ from pinned sources:
#   static/lib/doomgeneric/doomgeneric.{js,wasm}  doomgeneric + tools/engine/*
#   static/lib/freedoom/freedoom1.wad             Freedoom Phase 1 IWAD
#
# Requires Docker, Git, curl, Python 3, sha256sum and network access. Every
# input is pinned (the Emscripten image by digest, doomgeneric by commit,
# Freedoom by version and SHA-256), so a rebuild reproduces the committed files.
#
#   tools/build_engine.sh
set -euo pipefail

EMSDK_IMAGE="emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65"
# Our fork of ozkl/doomgeneric, kept so the engine's source stays available
# (GPL); the commit is tagged odoom-engine there.
DOOMGENERIC_URL="https://github.com/UCS-One-Business/doomgeneric.git"
DOOMGENERIC_COMMIT="dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284"
FREEDOOM_VERSION="0.13.0"
FREEDOOM_SHA256="3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"

MODULE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/odoom_build.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

# doomgeneric.c and dummy.c are left out: doomgeneric_odoo.c replaces them
# (see the note at its top).
echo "==> doomgeneric $DOOMGENERIC_COMMIT"
git init -q "$WORK/doomgeneric"
git -C "$WORK/doomgeneric" fetch -q --depth=1 "$DOOMGENERIC_URL" "$DOOMGENERIC_COMMIT"
git -C "$WORK/doomgeneric" checkout -q FETCH_HEAD
git -C "$WORK/doomgeneric" apply "$MODULE_DIR/tools/engine/odoo_hooks.patch"
cp "$MODULE_DIR/tools/engine/doomgeneric_odoo.c" "$MODULE_DIR/tools/engine/odoo_hooks.h" \
    "$WORK/doomgeneric/doomgeneric/"

SOURCES="am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode
d_net f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound
i_system i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random
p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg
p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs
r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum
w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric_odoo"
C_FILES=$(for s in $SOURCES; do printf '%s.c ' "$s"; done)

echo "==> emcc ($EMSDK_IMAGE)"
docker run --rm -u "$(id -u):$(id -g)" -v "$WORK/doomgeneric/doomgeneric:/src" -w /src \
    "$EMSDK_IMAGE" sh -c "emcc --version | head -1 && emcc -O2 \
        -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE -Wno-everything \
        $C_FILES -o doomgeneric.js \
        -sMODULARIZE=1 -sEXPORT_NAME=createDoomEngine -sENVIRONMENT=web \
        -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1048576 \
        -sFORCE_FILESYSTEM=1 \
        -sEXPORTED_FUNCTIONS=_main,_doom_key,_doom_pause,_doom_stop \
        -sEXPORTED_RUNTIME_METHODS=callMain,FS,UTF8ToString"

OUT="$MODULE_DIR/static/lib/doomgeneric"
cp "$WORK/doomgeneric/doomgeneric/doomgeneric.js" "$WORK/doomgeneric/doomgeneric/doomgeneric.wasm" "$OUT/"
cp "$WORK/doomgeneric/LICENSE" "$OUT/COPYING"

echo "==> Freedoom $FREEDOOM_VERSION"
curl -fsSL -o "$WORK/freedoom.zip" \
    "https://github.com/freedoom/freedoom/releases/download/v$FREEDOOM_VERSION/freedoom-$FREEDOOM_VERSION.zip"
echo "$FREEDOOM_SHA256  $WORK/freedoom.zip" | sha256sum -c -
python3 - "$WORK/freedoom.zip" "$MODULE_DIR/static/lib/freedoom" <<'EOF'
import sys, zipfile
from pathlib import Path
archive, target = zipfile.ZipFile(sys.argv[1]), Path(sys.argv[2])
wanted = {"freedoom1.wad": "freedoom1.wad", "COPYING.txt": "COPYING.txt"}
for info in archive.infolist():
    name = Path(info.filename).name
    if name in wanted:
        (target / wanted.pop(name)).write_bytes(archive.read(info))
if wanted:
    sys.exit(f"missing from Freedoom archive: {sorted(wanted)}")
EOF

sha256sum "$OUT"/doomgeneric.* "$MODULE_DIR"/static/lib/freedoom/freedoom1.wad
