#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["fpdf2>=2.8"]
# ///
"""Render the Ivan markdown share-out to PDF.

Same converter used for the original Vera vs 9575F Ivan PDF
(vera-final/scripts/ivan_doc_to_pdf.py).

Rerun after doc or chart updates:

    python3 daniel-focus-here/ivan_doc_to_pdf.py

Optional:

    python3 daniel-focus-here/ivan_doc_to_pdf.py --open
    python3 daniel-focus-here/ivan_doc_to_pdf.py path/to.md -o path/to.pdf
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

FOCUS = Path(__file__).resolve().parent
DEFAULT_MD = FOCUS / "docs" / "updated-ivan-doc-9755.md"
DEFAULT_PDF = FOCUS / "docs" / "updated-ivan-doc-9755.pdf"

GREEN = (118, 185, 0)
DARK = (32, 33, 36)
MUTED = (111, 113, 119)

IMAGE_RE = re.compile(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$")
HEADING_RE = re.compile(r"^(#{1,3})\s+(.*)$")
OL_RE = re.compile(r"^(\d+)\.\s+(.*)$")
UL_RE = re.compile(r"^[-*+]\s+(.*)$")
QUOTE_RE = re.compile(r"^>\s?(.*)$")
TABLE_RE = re.compile(r"^\|.*\|$")
INLINE_RE = re.compile(r"(\*\*[^*]+?\*\*|\*[^*\s][^*]*?\*|`[^`]+`)")


def ensure_fpdf() -> None:
    try:
        import fpdf  # noqa: F401
        return
    except ImportError:
        pass
    extra = [arg for arg in sys.argv[1:] if arg != "--bootstrap"]
    if shutil.which("uv"):
        os.execvp(
            "uv",
            ["uv", "run", "--with", "fpdf2", str(Path(__file__).resolve()), *extra],
        )
    subprocess.check_call([sys.executable, "-m", "pip", "install", "fpdf2"])


ensure_fpdf()

from fpdf import FPDF  # noqa: E402


FONT_REGULAR = [
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
]
FONT_BOLD = [
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
]
FONT_ITALIC = [
    Path("/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"),
]


def first_existing(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.is_file():
            return path
    return None


def image_size(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return (1600, 750)


class IvanPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-14)
        self.set_font("Body", size=8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"{self.page_no()}", align="C")


def write_rich(pdf: FPDF, text: str, *, size: float, leading: float) -> None:
    pdf.set_font("Body", size=size)
    pdf.set_text_color(*DARK)
    for raw_line in text.split("\n"):
        parts = INLINE_RE.split(raw_line)
        if not parts:
            pdf.ln(leading)
            continue
        for part in parts:
            if not part:
                continue
            if part.startswith("**") and part.endswith("**"):
                pdf.set_font("Body", style="B", size=size)
                pdf.write(leading, part[2:-2])
                pdf.set_font("Body", size=size)
            elif len(part) > 2 and part.startswith("*") and part.endswith("*"):
                pdf.set_font("Body", style="I", size=size)
                pdf.write(leading, part[1:-1])
                pdf.set_font("Body", size=size)
            elif part.startswith("`") and part.endswith("`"):
                pdf.set_font("Body", size=size)
                pdf.write(leading, part[1:-1].replace(" ", "\u00a0"))
            else:
                pdf.set_font("Body", size=size)
                pdf.write(leading, part)
        pdf.ln(leading)


def add_image(pdf: FPDF, path: Path) -> None:
    remaining = pdf.h - pdf.b_margin - pdf.get_y() - 4
    max_w = pdf.epw
    page_cap = min(78.0, pdf.eph * 0.36)
    if remaining < 48:
        pdf.add_page()
        remaining = pdf.h - pdf.b_margin - pdf.get_y() - 4
    max_h = min(page_cap, remaining)
    width_px, height_px = image_size(path)
    aspect = height_px / width_px if width_px else 0.5
    draw_w = max_w
    draw_h = draw_w * aspect
    if draw_h > max_h:
        draw_h = max_h
        draw_w = draw_h / aspect
    x = pdf.l_margin + (pdf.epw - draw_w) / 2
    y = pdf.get_y()
    pdf.image(str(path), x=x, y=y, w=draw_w, h=draw_h)
    pdf.set_xy(pdf.l_margin, y + draw_h + 3)


def iter_blocks(markdown: str) -> list[tuple[str, str]]:
    blocks: list[tuple[str, str]] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    list_kind = "ol"
    quote_lines: list[str] = []

    def flush_quote() -> None:
        # Consecutive `>` lines form one block; bare `>` lines are paragraph breaks.
        nonlocal quote_lines
        if quote_lines:
            paragraphs = " ".join(quote_lines).split("\0")
            blocks.append(("quote", "\n\n".join(p.strip() for p in paragraphs if p.strip())))
            quote_lines = []

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            blocks.append(("p", " ".join(paragraph)))
            paragraph = []

    def flush_list() -> None:
        nonlocal list_items
        if list_items:
            blocks.append((list_kind, "\n".join(list_items)))
            list_items = []

    lines = markdown.splitlines()
    for line_index, raw in enumerate(lines):
        hard_break = raw.endswith("  ")
        line = raw.rstrip()
        if not line:
            flush_paragraph()
            flush_list()
            flush_quote()
            continue
        heading = HEADING_RE.match(line)
        image = IMAGE_RE.match(line)
        ordered = OL_RE.match(line)
        bullet = UL_RE.match(line)
        quote = QUOTE_RE.match(line)
        table = TABLE_RE.match(line)
        if not quote:
            flush_quote()
        if heading:
            flush_paragraph()
            flush_list()
            blocks.append((f"h{len(heading.group(1))}", heading.group(2).strip()))
        elif image:
            flush_paragraph()
            flush_list()
            blocks.append(("img", image.group(2).strip()))
        elif ordered or bullet:
            flush_paragraph()
            kind = "ol" if ordered else "ul"
            if list_items and kind != list_kind:
                flush_list()
            list_kind = kind
            list_items.append((ordered.group(2) if ordered else bullet.group(1)).strip())
        elif quote:
            flush_paragraph()
            flush_list()
            quote_lines.append(quote.group(1).strip() or "\0")
        elif table:
            flush_paragraph()
            flush_list()
            if line_index > 0 and TABLE_RE.match(lines[line_index - 1].strip()):
                continue
            rows = [line]
            for following in lines[line_index + 1:]:
                if not TABLE_RE.match(following.strip()):
                    break
                rows.append(following.strip())
            blocks.append(("table", "\n".join(rows)))
        else:
            flush_list()
            paragraph.append(line)
            if hard_break:
                flush_paragraph()
    flush_paragraph()
    flush_list()
    flush_quote()
    return blocks


def render(md_path: Path, pdf_path: Path) -> None:
    regular = first_existing(FONT_REGULAR)
    bold = first_existing(FONT_BOLD)
    italic = first_existing(FONT_ITALIC)
    if regular is None:
        raise SystemExit("No Unicode TTF found. Install Arial or DejaVu Sans.")

    markdown = md_path.read_text(encoding="utf-8")
    pdf = IvanPDF(format="Letter", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(18, 16, 18)
    pdf.add_font("Body", fname=str(regular))
    pdf.add_font("Body", style="B", fname=str(bold or regular))
    pdf.add_font("Body", style="I", fname=str(italic or regular))
    pdf.set_title("Vera vs Zen 5 9575F vs 9755 for packed agent sandboxes")
    pdf.set_author("Daytona")
    pdf.add_page()

    for kind, value in iter_blocks(markdown):
        if kind == "h1":
            pdf.set_font("Body", style="B", size=20)
            pdf.set_text_color(*GREEN)
            pdf.multi_cell(0, 8, value)
            pdf.ln(2)
        elif kind == "h2":
            pdf.ln(2)
            pdf.set_font("Body", style="B", size=13)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(0, 7, value)
            pdf.ln(1)
        elif kind == "h3":
            pdf.ln(2)
            pdf.set_font("Body", style="B", size=11.5)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(0, 6.5, value)
            pdf.ln(1)
        elif kind == "p":
            is_kicker = pdf.page_no() == 1 and pdf.get_y() < 42 and len(value) < 100
            if is_kicker:
                pdf.set_font("Body", size=10.5)
                pdf.set_text_color(*MUTED)
                pdf.multi_cell(0, 6, value)
                pdf.ln(0.6)
            else:
                write_rich(pdf, value, size=11, leading=6.2)
                pdf.ln(1.8)
        elif kind == "quote":
            x = pdf.l_margin
            pdf.set_font("Body", size=11)
            # Keep the quote on one page so the fill and accent bar stay continuous.
            lines = pdf.multi_cell(pdf.epw - 4, 6.2, value, dry_run=True, output="LINES")
            if pdf.get_y() + 6.2 * len(lines) > pdf.page_break_trigger:
                pdf.add_page()
            y = pdf.get_y()
            pdf.set_fill_color(244, 247, 239)
            pdf.set_draw_color(*GREEN)
            pdf.set_line_width(1.2)
            pdf.set_font("Body", size=11)
            pdf.set_text_color(*DARK)
            pdf.set_x(x + 4)
            pdf.multi_cell(pdf.epw - 4, 6.2, value, fill=True)
            pdf.line(x, y, x, pdf.get_y())
            pdf.ln(3)
        elif kind == "table":
            rows = []
            for row in value.splitlines():
                cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                if cells and not all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    rows.append(cells)
            if rows:
                widths = [pdf.epw * 0.38, pdf.epw * 0.32, pdf.epw * 0.30]
                row_height = 8
                if pdf.get_y() + row_height * len(rows) + 3 > pdf.page_break_trigger:
                    pdf.add_page()
                pdf.set_draw_color(210, 214, 207)
                for row_index, cells in enumerate(rows):
                    if row_index == 0:
                        pdf.set_fill_color(*GREEN)
                        pdf.set_text_color(255, 255, 255)
                        pdf.set_font("Body", style="B", size=10)
                    else:
                        pdf.set_fill_color(245 if row_index % 2 else 255, 247 if row_index % 2 else 255, 242 if row_index % 2 else 255)
                        pdf.set_text_color(*DARK)
                        pdf.set_font("Body", size=10)
                    y = pdf.get_y()
                    x = pdf.l_margin
                    for col_index, width in enumerate(widths):
                        text = cells[col_index] if col_index < len(cells) else ""
                        pdf.set_fill_color(*(GREEN if row_index == 0 else (245, 247, 242) if row_index % 2 else (255, 255, 255)))
                        pdf.rect(x, y, width, row_height, style="DF")
                        pdf.set_xy(x + 2, y + 1)
                        pdf.cell(width - 4, row_height - 2, text)
                        x += width
                    pdf.set_y(y + row_height)
                pdf.set_text_color(*DARK)
                pdf.ln(3)
        elif kind in ("ol", "ul"):
            indent = 8 if kind == "ol" else 6
            for index, item in enumerate(value.split("\n"), start=1):
                x = pdf.l_margin
                y = pdf.get_y()
                pdf.set_font("Body", style="B", size=11)
                pdf.set_text_color(*GREEN)
                pdf.set_xy(x, y)
                pdf.cell(indent, 6.2, f"{index}." if kind == "ol" else "\u2022")
                # Indent wrapped lines to align under the item text.
                pdf.set_left_margin(x + indent)
                pdf.set_xy(x + indent, y)
                write_rich(pdf, item, size=11, leading=6.2)
                pdf.set_left_margin(x)
                pdf.ln(0.8)
            pdf.ln(1.6)
        elif kind == "img":
            image_path = (md_path.parent / value).resolve()
            if not image_path.is_file():
                raise SystemExit(f"Missing image: {image_path}")
            add_image(pdf, image_path)

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(pdf_path))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render the Ivan markdown doc to PDF.")
    parser.add_argument("markdown", nargs="?", type=Path, default=DEFAULT_MD)
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_PDF)
    parser.add_argument(
        "--open", action="store_true", help="Open the PDF after writing it."
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    md_path = args.markdown.resolve()
    pdf_path = args.output.resolve()
    if not md_path.is_file():
        raise SystemExit(f"Markdown not found: {md_path}")
    render(md_path, pdf_path)
    print(pdf_path)
    if args.open:
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        subprocess.Popen([opener, str(pdf_path)])


if __name__ == "__main__":
    main()
