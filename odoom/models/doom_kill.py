from datetime import UTC, datetime

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .doom_selections import MONSTER_TYPES


class DoomKill(models.Model):
    """One monster killed while playing Doom in a spreadsheet."""

    _name = "doom.kill"
    _description = "Doom Kill"
    _order = "date desc, id desc"

    user_id = fields.Many2one(
        "res.users", string="Player", required=True, index=True, readonly=True,
        default=lambda self: self.env.user,
    )
    monster_type = fields.Selection(MONSTER_TYPES, required=True, readonly=True)
    map = fields.Char(required=True, readonly=True)
    date = fields.Datetime(required=True, readonly=True)

    @api.model
    def record_kills(self, kills):
        """Store a batch of kills for the current user.

        Each kill is ``{"monster", "map", "at"}``, ``at`` in epoch
        milliseconds. An unknown monster key rejects the batch.
        """
        monsters = dict(MONSTER_TYPES)
        values = []
        for kill in kills:
            if kill["monster"] not in monsters:
                raise ValidationError(self.env._("Unknown Doom monster: %r.", kill["monster"]))
            values.append({
                "monster_type": kill["monster"],
                "map": kill["map"],
                "date": datetime.fromtimestamp(kill["at"] / 1000, UTC).replace(tzinfo=None),
            })
        self.create(values)
        return len(values)
