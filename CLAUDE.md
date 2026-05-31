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

This is a minimal Flask personal academic website with two routes:

- `/` — About page, shows bio, awards, social links, and selected publications
- `/publications` — Full publications list grouped by year

**Content is defined in two places only:**

1. `app.py` — The `SITE` dict at the top holds all personal info (name, bio paragraphs, awards, social links). Edit this to update any biographical content.
2. `data/papers.bib` — All publications in BibTeX format. Custom fields beyond standard BibTeX:
   - `abbr` — Short venue name shown as a badge
   - `selected = {true}` — Whether to show on the homepage
   - `preview` — Filename of the thumbnail image (stored in `static/img/publication_preview/`)
   - `award_name` — Short award label shown as a badge
   - `arxiv` — arXiv ID (just the number, e.g. `2207.11120`) or full URL

**Template structure:**

- `templates/base.html` — Nav and footer wrapper; all pages extend this
- `templates/index.html` / `templates/publications.html` — Page content
- `templates/partials/pub_card.html` — Reusable publication card included in both pages

The `parse_publications()` function in `app.py` reads the BibTeX on every request (no caching), strips LaTeX markup via `clean_latex()`, and sorts publications newest-first with selected ones prioritised within the same year.

Equal-contribution authors are marked with `$*$` or `\\*` in the BibTeX author field and rendered with a superscript `*`. The `is_me()` helper in `app.py` identifies Paul Brunzema's name to apply the `author-me` CSS class.
