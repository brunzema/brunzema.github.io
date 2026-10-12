"""Build the web versions of the publication preview images.

The originals live in data/publication_preview/ (multi-megabyte PNGs, not
deployed). Each one becomes two WebP files under static/img/publication_preview/:
    thumb/<name>.webp   the card thumbnail
    full/<name>.webp    what the lightbox opens on click

Run after adding or replacing an original (needs Pillow: pip install pillow):
    python build_images.py
The outputs are committed, so the deploy does not need to run this.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
SRC = ROOT / "data" / "publication_preview"
OUT = ROOT / "static" / "img" / "publication_preview"
SIZES = {"thumb": (640, 80), "full": (2000, 86)}  # folder: (max width, quality)

if __name__ == "__main__":
    for src in sorted(SRC.iterdir()):
        if src.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        for folder, (max_w, quality) in SIZES.items():
            dst = OUT / folder / f"{src.stem}.webp"
            if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            img = Image.open(src).convert("RGB")
            if img.width > max_w:
                img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
            img.save(dst, "WEBP", quality=quality, method=6)
            print(f"{dst.relative_to(ROOT)}  {dst.stat().st_size / 1024:.0f} KB")
