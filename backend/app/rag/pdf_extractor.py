"""PDF text extraction and page-aware chunking with PyMuPDF.

Chunks never cross a page boundary, so every chunk - and therefore every
citation built from it - maps to exactly one page number.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import pymupdf as fitz


@dataclass(frozen=True)
class PageText:
    page: int  # 1-indexed
    text: str


@dataclass(frozen=True)
class Chunk:
    page: int
    index: int
    text: str


_WS = re.compile(r"[ \t ]+")
# Split after terminal punctuation preceded by a word/number token (so bare section
# numbers such as "3." are not treated as sentence ends).
_SENTENCE_SPLIT = re.compile(r"(?<=[A-Za-z%)\]°][.!?;])\s+(?=[A-Z0-9(\[])|(?<=\w\d[.!?;])\s+(?=[A-Z(\[])")
_PAGE_MARKER = re.compile(r"^\s*(page\s+\d+(\s+of\s+\d+)?|\d+\s*/\s*\d+|-\s*\d+\s*-)\s*$", re.IGNORECASE)
_HEADING_MAX = 80


def _clean(text: str) -> str:
    text = text.replace("\r", "\n")
    text = re.sub(r"-\n(?=[a-z])", "", text)  # re-join hyphenated line breaks
    lines = [_WS.sub(" ", line).strip() for line in text.split("\n")]
    out: list[str] = []
    for line in lines:
        if not line:
            if out and out[-1] != "":
                out.append("")
            continue
        out.append(line)
    return "\n".join(out).strip()


def _line_key(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def extract_pages(data: bytes) -> list[PageText]:
    """Extract cleaned text for every page, preserving 1-indexed page numbers.

    Running headers/footers (lines repeated on most pages, ignoring digits) and
    bare page markers are removed so they never surface as answer "evidence".
    """
    with fitz.open(stream=data, filetype="pdf") as doc:
        raw = [_clean(page.get_text("text", sort=True)) for page in doc]
    repeated: set[str] = set()
    if len(raw) >= 2:
        counts: dict[str, int] = {}
        for text in raw:
            lines = [line for line in text.splitlines() if line.strip()]
            edges = lines[:2] + lines[-2:]  # headers/footers live at the page edges
            for key in {_line_key(line) for line in edges}:
                counts[key] = counts.get(key, 0) + 1
        repeated = {k for k, n in counts.items() if n >= max(2, (len(raw) + 1) // 2) and "#" in k}
    pages = []
    for i, text in enumerate(raw, start=1):
        lines = [line for line in text.splitlines()
                 if not _PAGE_MARKER.match(line) and _line_key(line) not in repeated]
        pages.append(PageText(page=i, text="\n".join(lines).strip()))
    return pages


def extract_title(data: bytes, fallback: str) -> str:
    with fitz.open(stream=data, filetype="pdf") as doc:
        meta_title = (doc.metadata or {}).get("title", "").strip()
        if meta_title:
            return meta_title[:200]
        if doc.page_count:
            for line in doc[0].get_text("text").splitlines():
                line = line.strip()
                if len(line) >= 4:
                    return line[:200]
    return fallback


def is_heading(segment: str) -> bool:
    s = segment.strip()
    return bool(s) and len(s) <= _HEADING_MAX and s[-1] not in ".!?;:,"


def split_sentences(text: str) -> list[str]:
    """Split text into sentences; short unpunctuated lines become their own (heading) segments."""
    segments: list[str] = []

    def flush(buffer: list[str]) -> None:
        if buffer:
            segments.extend(p.strip() for p in _SENTENCE_SPLIT.split(" ".join(buffer)) if p and p.strip())
            buffer.clear()

    for paragraph in re.split(r"\n{2,}", text):
        buffer: list[str] = []
        lines = [line.strip() for line in paragraph.split("\n") if line.strip()]
        for idx, line in enumerate(lines):
            nxt = lines[idx + 1] if idx + 1 < len(lines) else ""
            if is_heading(line) and (not nxt or nxt[:1].isupper() or nxt[:1].isdigit()):
                flush(buffer)
                segments.append(line)
            else:
                buffer.append(line)
        flush(buffer)
    return segments


def chunk_pages(pages: list[PageText], size: int = 700, overlap: int = 120) -> list[Chunk]:
    """Greedy sentence packing into ~``size``-character chunks with ``overlap``.

    Sentences are joined with newlines so headings stay recoverable when a chunk
    is split into sentences again at answer time.
    """
    if size <= 0:
        raise ValueError("chunk size must be positive")
    overlap = max(0, min(overlap, size // 2))
    chunks: list[Chunk] = []
    for page in pages:
        sentences = split_sentences(page.text)
        if not sentences:
            continue
        current = ""
        index = 0
        for sentence in sentences:
            # Hard-split pathological sentences that exceed the chunk size.
            pieces = [sentence[i:i + size] for i in range(0, len(sentence), size)] or [sentence]
            for piece in pieces:
                if current and len(current) + 1 + len(piece) > size:
                    chunks.append(Chunk(page=page.page, index=index, text=current))
                    index += 1
                    tail = current[-overlap:] if overlap else ""
                    # Start the overlap at a word boundary.
                    tail = tail[tail.find(" ") + 1:] if " " in tail else tail
                    current = f"{tail}\n{piece}".strip() if tail else piece
                else:
                    current = f"{current}\n{piece}".strip()
        if current:
            chunks.append(Chunk(page=page.page, index=index, text=current))
    return chunks


def render_page_png(path: str, page_number: int, highlights: list[str] | None = None, zoom: float = 1.5) -> bytes:
    """Render one page to PNG, highlighting every occurrence of the given phrases."""
    with fitz.open(path) as doc:
        if not 1 <= page_number <= doc.page_count:
            raise IndexError(f"Page {page_number} is out of range (1-{doc.page_count}).")
        page = doc[page_number - 1]
        for phrase in highlights or []:
            phrase = phrase.strip()
            if len(phrase) < 3:
                continue
            for rect in page.search_for(phrase[:120]):
                annot = page.add_highlight_annot(rect)
                annot.set_colors(stroke=(0.06, 0.73, 0.51))
                annot.update()
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
