from odoo.tests import HttpCase, tagged


def _hoot_id(name):
    """Hoot's job id for a suite name (same hash as web/tests/test_js.py)."""
    value = 0
    for char in name:
        value = ((value << 5) - value + ord(char)) & 0xFFFFFFFF
    return f"{value:08x}"


@tagged("post_install", "-at_install")
class TestJs(HttpCase):
    def test_hoot(self):
        """Runs only this addon's hoot suite (static/tests/*.test.js)."""
        self.browser_js(
            f"/web/tests?headless&loglevel=2&preset=desktop&timeout=15000&id={_hoot_id('@odoom')}",
            "", "", login="admin", timeout=600,
            success_signal="[HOOT] Test suite succeeded",
            error_checker=lambda message: "[HOOT]" not in message,
        )
