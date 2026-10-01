from odoo.tests import HttpCase, new_test_user, tagged


@tagged("post_install", "-at_install")
class TestSheetTour(HttpCase):
    def test_sheet_tour(self):
        """Doom > Insert Doom Screen in a Documents spreadsheet: the engine
        paints the cells in colour, Play takes and gives back the keyboard,
        and the inserted formula is saved with the spreadsheet."""
        player = new_test_user(self.env, "doom_sheet", groups="documents.group_documents_user")
        spreadsheet = self.env["documents.document"].create({
            "name": "Q3 Budget",
            "handler": "spreadsheet",
            "mimetype": "application/o-spreadsheet",
            "spreadsheet_data": "{}",
            "owner_id": player.id,
        })
        self.start_tour(f"/odoo/spreadsheet/{spreadsheet.id}", "odoom_sheet", login=player.login)
        revisions = self.env["spreadsheet.revision"].search([
            ("res_model", "=", "documents.document"), ("res_id", "=", spreadsheet.id),
        ])
        self.assertIn("=DOOM(120, 75)", "".join(revisions.mapped("commands")))
