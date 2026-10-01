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
// The player's kills, reported to the odoom module.
#ifndef DOOM_ODOO_HOOKS_H
#define DOOM_ODOO_HOOKS_H

#include "p_mobj.h"

void Odoo_OnKill(mobj_t *source, mobj_t *target);

#endif
