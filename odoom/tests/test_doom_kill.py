import time

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged
from odoo.tests.common import TransactionCase


def kill(monster="imp", map_name="E1M1"):
    return {"monster": monster, "map": map_name, "at": int(time.time() * 1000)}


@tagged("post_install", "-at_install")
class TestDoomKill(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.player = new_test_user(cls.env, "doom_player", name="Player One")
        cls.rival = new_test_user(cls.env, "doom_rival")
        cls.admin = new_test_user(cls.env, "doom_admin", groups="base.group_system")

    def test_kills_are_recorded_for_the_caller(self):
        Kill = self.env["doom.kill"].with_user(self.player)
        self.assertEqual(Kill.record_kills([kill(), kill("zombieman", "E1M2")]), 2)
        kills = Kill.search([("user_id", "=", self.player.id)])
        self.assertEqual(sorted(kills.mapped("monster_type")), ["imp", "zombieman"])
        self.assertEqual(kills.mapped("user_id"), self.player)

    def test_an_unknown_monster_rejects_the_batch(self):
        Kill = self.env["doom.kill"].with_user(self.player)
        with self.assertRaises(ValidationError):
            Kill.record_kills([kill(), kill(monster="cyberimp")])
        self.assertFalse(Kill.search([("user_id", "=", self.player.id)]))

    def test_everyone_reads_nobody_else_edits(self):
        self.env["doom.kill"].with_user(self.player).record_kills([kill()])
        theirs = self.env["doom.kill"].with_user(self.rival).search([("user_id", "=", self.player.id)])
        self.assertEqual(len(theirs), 1, "the kills chart counts every player")
        with self.assertRaises(AccessError):
            theirs.unlink()
        with self.assertRaises(AccessError):
            self.env["doom.kill"].with_user(self.rival).create({
                "user_id": self.player.id, "monster_type": "imp",
                "map": "E1M1", "date": "2026-01-01 00:00:00",
            })
        theirs.with_user(self.admin).unlink()
