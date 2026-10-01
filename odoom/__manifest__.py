{
    "name": "oDoom",
    "version": "19.0.1.0.0",
    "summary": "Play Doom inside an Odoo spreadsheet: =DOOM() turns cells into pixels",
    "category": "Productivity/Documents",
    "author": "UCS OneDo AB",
    "website": "https://github.com/UCS-One-Business/odoom",
    "license": "GPL-3",
    "depends": ["documents_spreadsheet"],
    "data": [
        "security/ir.model.access.csv",
        "security/doom_security.xml",
    ],
    "assets": {
        # Loaded with the spreadsheet editor only, next to o-spreadsheet.
        "spreadsheet.o_spreadsheet": [
            "odoom/static/src/engine/**/*",
            "odoom/static/src/spreadsheet/**/*",
        ],
        "web.assets_unit_tests": [
            "odoom/static/tests/**/*.test.js",
        ],
        "web.assets_tests": [
            "odoom/static/tests/tours/**/*",
        ],
    },
    "images": ["static/description/screenshot.png"],
    "installable": True,
}
