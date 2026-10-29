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
- `/visualizations/` — Gallery of interactive mathematical notes
- `/visualizations/flow-matching/` — Conditional/marginal probability paths, the CFM regression identity, and image generation in 196 dimensions
- `/visualizations/optimization/` — Optimization overview plus a linked 24-dimensional tensor experiment
- `/visualizations/stein-variational-inference/` — Stein particle transport, custom Gaussian mixtures, Stein identity, and Old Faithful density estimation
- `/visualizations/pareto/` — Time-varying two-objective Pareto-front experiment
- `/visualizations/gaussian-splatting/` — Splat anatomy, ordered alpha compositing, a live image fit, and a 3-D EWA renderer
- `/ascii/` — Monospace "ASCII edition" of the homepage (after ascii.rest), self-contained: `templates/ascii_base.html` (sidebar, top bar, footer) → `ascii.html`, `static/css/ascii.css`, `static/js/ascii.js`. Reached via the `>_ ascii` pill in the homepage hero.
- `/ascii/publications/` — All publications in the ASCII style (`ascii_publications.html`; rows from `partials/ascii_pub.html`). The interactive notes have no ASCII version; the ASCII sidebar says so and links to the classic ones.
- `/cv.pdf` — Serves `data/cv.pdf` directly
- `/404.html` — ASCII-style 404 (`ascii_404.html`, `static/js/ascii-404.js`), also the Flask 404 handler; GitHub Pages serves it for every unknown path, so its URLs must stay root-absolute. It is a manual Bayesian optimization: the hero's GP posterior with the visitor as acquisition function (click or arrow keys + Enter to evaluate, `[reveal f]`, `[reset]`). `ascii-404.js` sets `window.asciiPage`, which `ascii.js` calls with the shared `kit`.

**Biographical and publication content is defined in two places:**

1. `app.py` — The `SITE` dict at the top holds all personal info (name, bio paragraphs, `experience` timeline entries, awards, social links). Edit this to update any biographical content. Experience entries reference logo SVGs in `static/img/logos/`.
2. `data/papers.bib` — All publications in BibTeX format. Custom fields beyond standard BibTeX:
   - `abbr` — Short venue name shown as a badge
   - `selected = {true}` — Whether to show on the homepage
   - `month` — Numeric publication, preprint, or conference month (1–12); both publication lists sort by year and month, newest first. Missing months sort last within their year; ties keep bibliography order.
   - `preview` — Filename of the original image in `data/publication_preview/` (not deployed). `python build_images.py` (needs Pillow) turns each original into `static/img/publication_preview/thumb/<name>.webp` for the card and `full/<name>.webp` for the lightbox; both are committed, so rerun it after adding or replacing an original.
   - `award_name` — Short award label shown as a badge
   - `arxiv` — arXiv ID (just the number, e.g. `2207.11120`) or full URL
   - `html` / `pdf` — Link URLs for the card buttons

Interactive-note copy and structure live in the visualization templates; their dependency-free canvas simulations live under `static/js/`.

`static/js/splat.js` and `static/js/splat-fit.js` drive the Gaussian splatting note. `splat.js` holds the single-splat anatomy panel, the six-splat compositing panel (front-to-back blending with a clickable per-pixel probe), and a CPU rasteriser for 3-D scenes: covariances are projected with the EWA affine Jacobian (`Σ' = J W Σ Wᵀ Jᵀ` plus the 0.3 px² low-pass term), depth-sorted by counting sort, and composited front-to-back into a Float32 framebuffer whose resolution adapts to the measured frame cost. Splats are always iterated in a fixed shuffled order so that switching the depth sort off shows genuine ordering artefacts. `splat-fit.js` is a complete differentiable rasteriser at 96×96: analytic 3DGS gradients (no autodiff), Adam, and clone/split/prune density control; scale and rotation are the parameters, never Σ. Its "Sandbox" target is a paintable canvas — brush strokes write straight into the target buffer while the optimizer keeps running, so density control has no upper iteration bound. Both files tabulate `exp(−½·)` because the inner loop runs millions of times per frame.

`static/js/ascii.js` draws everything on `/ascii/` as character grids (`Grid` → `<pre>`) driven by one loop that only ticks on-screen scenes — currently the hero (exact-GP Bayesian optimization with expected improvement). The hero is opt-in: the homepage shows only an opener beside the tagline (`bayesian optimization  [  ▶ run  ]`, a padded bracket button after ascii.rest's form controls, revealed once the tagline has been typed); clicking it unhides the figure, builds the scene (lazily, because it needs the well's width) and starts it, and `[close]` folds it away. Selected publications are a plain text list. Hero variants live in their own files (e.g. `ascii-hero-agentic.js`), are loaded before `ascii.js`, and register `window.asciiHeroes[name] = (pre, facts, kit) => ({ tick, destroy })`; `kit` is the shared grid/GP toolkit. The page shares only the `theme` localStorage key with the main site.

`static/js/flow.js` computes every field on the flow matching note in closed form — no network is trained. Data (2-D point sets, or 14×14 digit rasters produced by `buildGlyphLibrary()`) become isotropic Gaussian components, so the marginal velocity `u_t(x)` is an exact posterior-weighted sum; the same dimension-agnostic helpers drive both the 2-D panels and the 196-D image panel. Panels share a `viewFor()` world window that keeps equal scale on both axes.

**Template structure:**

- `templates/base.html` — Nav and footer wrapper; all pages extend this
- `templates/index.html` / `templates/publications.html` — Page content
- `templates/visualizations.html` — Visualization gallery; `gaussian_splatting.html`, `flow_matching.html`, `optimization.html`, `stein_variational.html`, and `pareto.html` are the individual entries
- `templates/partials/pub_card.html` — Reusable publication card included in both pages. Its thumbnail is a button that opens the full image in the `<dialog class="lightbox">` from `base.html` (wired in `static/js/ui.js`).
- `templates/partials/meta.html` — Meta description and Open Graph / Twitter tags, included by both `base.html` and `ascii_base.html`; reads `SITE["url"]` and `SITE["description"]`.

The `parse_publications()` function in `app.py` reads the BibTeX on every request (no caching), strips LaTeX markup via `clean_latex()`, and sorts publications newest-first by year and month. The homepage filters this ordered list to selected papers.

Equal-contribution authors are marked with `*`, `$*$` or `\\*` in the BibTeX author field and rendered with a superscript `*`. The `is_me()` helper in `app.py` identifies Paul Brunzema's name to apply the `author-me` CSS class.

**Design system:**

Quiet, letter-like layout after molly.studio, on the cool grey page shared with the ASCII edition. Everything is driven by tokens at the top of `static/css/style.css`: a 4pt spacing scale (`--s-1`…`--s-8`), a radius scale (`--r-xs`…`--r-2xl`), a type scale (`--t-caption`…`--t-display`), column widths (`--letter` for text, `--media` for rails), and motion (`--spring` + `--dur-spring`, a critically damped spring as CSS `linear()`). Use the tokens rather than new literal values.

- **Type is San Francisco** via the `-apple-system` stack (`--font-display` / `--font-body`); no webfonts. **One weight:** display type is 400, and hierarchy comes from ink vs. grey, not bold (500 at most for emphasis). Letter-column copy uses `--prose`; links in it are `--ink` with no underline at rest — `--prose` is chosen so ink links keep 3:1 against it (and 4.5:1 on the page) in both themes, so keep that pair if either changes.
- **Centred openings**: the hero (photo, name, role) and page headers are centred; running text sits in the narrow `.letter` column.
- **Media are bare rounded tiles**, no glass: publication thumbnails and gallery previews lift on hover (`scale(1.025)` + `--lift` drop-shadow on `--spring`). `.pub-card` is always such a tile with its caption beneath; `.exp-list` is bare rows separated by hairlines.
- **Breakout rail**: homepage selected publications are a `.pub-rail` that starts at the `--media` column's left edge, bleeds off the right, and scroll-snaps; the round `.rail-btn` arrows are wired in `static/js/ui.js`. The publications page lays the same tiles two up per year in the `.media` column (`.pub-grid`). The gallery shows the newest note as a wide feature tile, the rest two up.
- **Page glow**: the publications page opens with a tall centred title whose bottom glows with the newest paper's thumbnail, blurred (`.page-header--glow` / `.page-glow`), multiplied in light mode so only the pigment tints the page (`--glow-opacity` / `--glow-blend` per theme).
- The lightbox is a 24px-radius sheet over a page-coloured dimmer; the footer is a centred `pb` monogram.
- The glass tokens (`--glass`, `--card-elev`) now only serve the interactive notes. They were built on an earlier editorial chrome; an additive **"INTERACTIVE NOTES — design language"** layer near the end of the stylesheet restyles their surfaces, controls, and radii. It wins by cascade order, so keep it last and add note-chrome overrides there.

`static/js/ui.js` toggles `nav.is-scrolled`, which reveals the nav's bottom hairline only once the page scrolls.

**Theming (light/dark):**

The theme is driven by a `data-theme` attribute on `<html>`, with all colors defined as CSS custom properties under `:root` (light) and `[data-theme="dark"]` in `static/css/style.css`. There is no hardcoded color anywhere else — add new colors as variables in both blocks.

Two ordering constraints the note pages depend on: `--bg-card` must stay **lighter** than `--bg-warm` (the segmented switches use warm as the track and card as the selected thumb), and `--bg` / `--bg-warm` are read from JS to paint the visualization canvases, so changing them changes the plots.

- An inline script in `base.html` `<head>` sets the initial theme from `localStorage` or `prefers-color-scheme` before first paint (FOUC prevention) — keep theme init inline, not in an external file.
- `static/js/theme.js` wires the nav toggle button, persists the choice, and fires a `themechange` window event.

**Hero animation:**

`static/js/gp.js` paints the ambient background on `<canvas id="gp">` (homepage only) — a drifting Gaussian-mixture density with contour rings plus Bayesian-optimization "walkers", reflecting the site owner's research themes (uncertainty quantification + sequential decision-making). It reads its palette from the `--accent` and `--bg-rgb` CSS variables via `syncThemeColors()`, re-syncs on the `themechange` event (never per frame), and honours `prefers-reduced-motion` (renders a single static frame). The canvas is capped at one screen (`--gp-h` on `.hero`) and faded out by `.hero-veil`: its cost is per pixel and its fixed-row density/contour grids coarsen if it is stretched over the whole hero. It pauses while off screen or in a hidden tab. No dependencies.
