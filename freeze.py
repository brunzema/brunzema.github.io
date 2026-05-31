"""Freeze the Flask site to static files in dist/ for GitHub Pages.

Run with: python freeze.py
Then preview exactly as GitHub Pages would serve it:
    python -m http.server -d dist 8000
"""

from pathlib import Path

from flask_frozen import Freezer

from app import app

app.config["FREEZER_DESTINATION"] = "dist"
app.config["FREEZER_REMOVE_EXTRA_FILES"] = True

freezer = Freezer(app)

if __name__ == "__main__":
    freezer.freeze()
    # GitHub Pages runs Jekyll by default; this opts the output out of it.
    (Path(app.root_path) / "dist" / ".nojekyll").touch()
    print("Site frozen to dist/")
