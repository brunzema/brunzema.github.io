# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the site

```bash
source venv/bin/activate
python app.py          # serves at http://localhost:8080
```

Install dependencies into the venv if needed:
```bash
pip install -r requirements.txt
```

## Architecture

This is a minimal Flask personal academic website with these routes:

- `/` — About page, shows bio, experience timeline, awards, social links, and selected publications
- `/publications` — Full publications list grouped by year
- `/cv.pdf` — Serves `data/cv.pdf` directly

**Content is defined in two places only:**

1. `app.py` — The `SITE` dict at the top holds all personal info (name, bio paragraphs, `experience` timeline entries, awards, social links). Edit this to update any biographical content. Experience entries reference logo SVGs in `static/img/logos/`.
2. `data/papers.bib` — All publications in BibTeX format. Custom fields beyond standard BibTeX:
   - `abbr` — Short venue name shown as a badge
   - `selected = {true}` — Whether to show on the homepage
   - `preview` — Filename of the thumbnail image (stored in `static/img/publication_preview/`)
   - `award_name` — Short award label shown as a badge
   - `arxiv` — arXiv ID (just the number, e.g. `2207.11120`) or full URL
   - `html` / `pdf` — Link URLs for the card buttons

**Template structure:**

- `templates/base.html` — Nav and footer wrapper; all pages extend this
- `templates/index.html` / `templates/publications.html` — Page content
- `templates/partials/pub_card.html` — Reusable publication card included in both pages

The `parse_publications()` function in `app.py` reads the BibTeX on every request (no caching), strips LaTeX markup via `clean_latex()`, and sorts publications newest-first with selected ones prioritised within the same year.

Equal-contribution authors are marked with `$*$` or `\\*` in the BibTeX author field and rendered with a superscript `*`. The `is_me()` helper in `app.py` identifies Paul Brunzema's name to apply the `author-me` CSS class.

**Theming (light/dark):**

The theme is driven by a `data-theme` attribute on `<html>`, with all colors defined as CSS custom properties under `:root` (light) and `[data-theme="dark"]` in `static/css/style.css`. There is no hardcoded color anywhere else — add new colors as variables in both blocks.

- An inline script in `base.html` `<head>` sets the initial theme from `localStorage` or `prefers-color-scheme` before first paint (FOUC prevention) — keep theme init inline, not in an external file.
- `static/js/theme.js` wires the nav toggle button, persists the choice, and fires a `themechange` window event.

**Hero animation:**

`static/js/gp.js` paints the ambient background on `<canvas id="gp">` (homepage only) — a drifting Gaussian-mixture density with contour rings plus Bayesian-optimization "walkers", reflecting the site owner's research themes (uncertainty quantification + sequential decision-making). It reads its palette from the `--accent` and `--bg-rgb` CSS variables via `syncThemeColors()`, re-syncs on the `themechange` event, and honours `prefers-reduced-motion` (renders a single static frame). No dependencies.
