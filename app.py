"""
Paul Brunzema — Personal Website
Run with: python app.py
Then open: http://localhost:8080
"""

import os
import re
from flask import Flask, render_template, request, send_from_directory
import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import convert_to_unicode

app = Flask(__name__)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────────────────────
# SITE CONTENT — edit this section to update your website
# ─────────────────────────────────────────────

SITE = {
    "name": "Paul Brunzema",
    "title": "PhD Student",
    "affiliation": "Institute for Data Science in Mechanical Engineering (DSME), RWTH Aachen University",
    "supervisor": "Sebastian Trimpe",
    "email": "brunzema@dsme.rwth-aachen.de",
    "bio": [
        (
            "I am a PhD student at the "
            '<a href="https://dsme.rwth-aachen.de">Institute for Data Science in Mechanical Engineering (DSME)</a> '
            "at RWTH Aachen University, supervised by "
            '<a href="https://sites.google.com/view/sebastian-trimpe">Sebastian Trimpe</a>, '
            "since March 2022. Since September 2023, I am also an associate doctoral researcher in the "
            '<a href="https://unravel.rwth-aachen.de">UnRAVel Research Training Group</a>, funded by the DFG.'
        ),
        (   
            "I am currently a research scientist intern at "
            '<a href="https://meta.com">Meta</a> '
            "working on Bayesian optimization and AutoML. "
            "In summer 2025, I joined the "
            '<a href="https://www.tri.global/research/epic">EPIC group at Toyota Research Institute (TRI)</a> '
            "in Los Altos, CA as a research intern, working on autonomous racing in changing conditions."
        ),
        (
            "My research focuses on <strong>uncertainty quantification</strong> "
            "(Gaussian processes, Bayesian neural networks) and "
            "<strong>sequential decision-making</strong> "
            "(Bayesian optimization, control, reinforcement learning)."
        ),
    ],
    "awards": [
        "SEW-EURODRIVE Student Award",
        "RWTH Dean's List (×3)",
        "MathWorks Fellowship for Graduate Students",
        "Germany Scholarship",
    ],
    "experience": [
        {
            "role": "Research Scientist Intern",
            "group": "",
            "org": "Meta, New York, NY",
            "org_short": "Meta",
            "url": "https://ai.meta.com",
            "logo": "meta.svg",
            "period": "Summer 2026",
            "location": "New York, NY",
            "note": "",
        },
        {
            "role": "Research Scientist Intern",
            "group": "EPIC Group",
            "org": "Toyota Research Institute, Los Altos, CA",
            "org_short": "TRI",
            "url": "https://www.tri.global/research/epic",
            "logo": "tri.svg",
            "period": "Summer 2025",
            "location": "Los Altos, CA",
            "note": "Autonomous racing in changing conditions.",
        },
        {
            "role": "PhD Student",
            "group": "Institute for Data Science in Mechanical Engineering",
            "org": "RWTH Aachen University, Germany",
            "org_short": "RWTH",
            "url": "https://dsme.rwth-aachen.de",
            "logo": "rwth.svg",
            "period": "Mar 2022 – present",
            "location": "Aachen, Germany",
            "note": "Supervised by Sebastian Trimpe. Associate doctoral researcher, UnRAVel Research Training Group (DFG) since Sep 2023.",
        },
        {
            "role": "M.Sc. Automation Engineering",
            "group": "",
            "org": "RWTH Aachen University, Germany",
            "org_short": "RWTH",
            "url": "https://rwth-aachen.de",
            "logo": "rwth.svg",
            "period": "Oct 2015 – Dec 2021",
            "location": "Aachen, Germany",
            "note": "",
        },
    ],
    "social": {
        "email": "brunzema@dsme.rwth-aachen.de",
        "scholar": "https://scholar.google.com/citations?user=JnoANJEAAAAJ",
        "github": "https://github.com/brunzema",
        "linkedin": "https://www.linkedin.com/in/paul-brunzema-9b0b09177",
    },
}


# ─────────────────────────────────────────────
# PUBLICATION PARSING
# ─────────────────────────────────────────────

def clean_latex(text: str) -> str:
    """Strip common LaTeX markup from a string."""
    if not text:
        return ""
    # Remove curly braces
    text = re.sub(r"\{|\}", "", text)
    # Unescape common characters
    text = text.replace("\\&", "&").replace("\\%", "%").replace('\\"o', "ö")
    text = text.replace('\\"a', "ä").replace('\\"u', "ü")
    # Remove remaining LaTeX commands
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)
    # Collapse extra whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_authors(author_str: str) -> list[dict]:
    """
    Parse BibTeX author string into a list of dicts with name and equal_contribution flag.
    Handles formats: 'Last, First' and 'First Last', with optional '$*$' for equal contrib.
    """
    if not author_str:
        return []

    authors = []
    for raw in author_str.split(" and "):
        raw = raw.strip()
        equal = "$*$" in raw or "\\*" in raw
        # Remove equal-contribution markers
        raw = raw.replace("$*$", "").replace("\\*", "").strip()

        if "," in raw:
            parts = raw.split(",", 1)
            name = f"{parts[1].strip()} {parts[0].strip()}"
        else:
            name = raw

        name = clean_latex(name).strip()
        authors.append({"name": name, "equal": equal})
    return authors


def is_me(name: str) -> bool:
    """Return True if this author is Paul Brunzema."""
    clean = name.lower().replace(".", "").strip()
    return "brunzema" in clean and "paul" in clean


def parse_publications() -> list[dict]:
    """Parse data/papers.bib and return a list of publication dicts."""
    bib_path = os.path.join(BASE_DIR, "data", "papers.bib")

    with open(bib_path, encoding="utf-8") as f:
        parser = BibTexParser(common_strings=True)
        parser.customization = convert_to_unicode
        bib = bibtexparser.load(f, parser=parser)

    publications = []
    for entry in bib.entries:
        venue = (
            entry.get("journal")
            or entry.get("booktitle")
            or entry.get("school")
            or entry.get("howpublished")
            or ""
        )

        arxiv_raw = entry.get("arxiv", "").strip()
        if arxiv_raw and not arxiv_raw.startswith("http"):
            arxiv_url = f"https://arxiv.org/abs/{arxiv_raw}"
        else:
            arxiv_url = arxiv_raw

        year_str = entry.get("year", "0").strip()
        year = int(year_str) if year_str.isdigit() else 0

        pub = {
            "key": entry.get("ID", ""),
            "title": clean_latex(entry.get("title", "")),
            "authors": parse_authors(entry.get("author", "")),
            "venue": clean_latex(venue),
            "abbr": clean_latex(entry.get("abbr", "")),
            "year": year,
            "abstract": clean_latex(entry.get("abstract", "")),
            "arxiv": arxiv_url,
            "html": entry.get("html", "").strip(),
            "pdf": entry.get("pdf", "").strip(),
            "preview": entry.get("preview", "").strip(),
            "selected": entry.get("selected", "").strip().lower() == "true",
            "award_name": clean_latex(entry.get("award_name", "")),
        }
        publications.append(pub)

    # Sort: newer first, selected prioritised within same year
    publications.sort(key=lambda p: (p["year"], p["selected"]), reverse=True)
    return publications


# ─────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────

@app.route("/")
def index():
    publications = parse_publications()
    selected = [p for p in publications if p["selected"]]
    return render_template("index.html", site=SITE, selected_publications=selected, is_me=is_me)


@app.route("/publications/")
def publications_page():
    pubs = parse_publications()

    # Group by year (descending)
    pubs_by_year: dict[int, list] = {}
    for pub in pubs:
        pubs_by_year.setdefault(pub["year"], []).append(pub)
    years = sorted(pubs_by_year.keys(), reverse=True)

    return render_template(
        "publications.html",
        site=SITE,
        pubs_by_year=pubs_by_year,
        years=years,
        is_me=is_me,
    )


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

@app.route("/cv.pdf")
def cv_pdf():
    return send_from_directory(os.path.join(BASE_DIR, "data"), "cv.pdf")


if __name__ == "__main__":
    print("Starting Paul Brunzema's website…")
    print("Open http://localhost:8080 in your browser.")
    app.run(debug=True, port=8080)
