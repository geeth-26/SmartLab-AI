"""Secure file validation pipeline.

Every upload passes through :func:`validate_upload`, which enforces, in order:

1. a non-empty, sanitised filename with an allow-listed extension;
2. a size limit (Flask's ``MAX_CONTENT_LENGTH`` also rejects oversized bodies);
3. magic-byte sniffing so the content matches the claimed extension;
4. format-specific deep checks - PDFs must open, be unencrypted, within the page
   limit and free of active content (JavaScript / launch actions); images must
   decode fully and stay under a pixel budget (decompression-bomb guard); text
   formats must be valid UTF-8.

Stored files get a random name, so user input never controls a filesystem path.
"""
from __future__ import annotations

import hashlib
import io
import re
import uuid
from dataclasses import dataclass

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

DOCUMENT_EXTENSIONS = {"pdf"}
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
SHARED_EXTENSIONS = DOCUMENT_EXTENSIONS | IMAGE_EXTENSIONS | {"csv", "txt", "json"}

_MAGIC = {
    "pdf": [b"%PDF-"],
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "webp": [b"RIFF"],  # plus b"WEBP" at offset 8, checked below
}

_MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "csv": "text/csv",
    "txt": "text/plain",
    "json": "application/json",
}

# PDF names that indicate active/executable content we refuse to store.
_PDF_ACTIVE_CONTENT = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b")


class FileValidationError(ValueError):
    """Raised when an upload fails validation. ``status`` is the HTTP code to return."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class ValidatedFile:
    original_name: str
    safe_name: str
    stored_name: str
    extension: str
    mime_type: str
    data: bytes
    sha256: str

    @property
    def size(self) -> int:
        return len(self.data)


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _check_magic(ext: str, data: bytes) -> None:
    signatures = _MAGIC.get(ext)
    if signatures is None:
        return
    if not any(data.startswith(sig) for sig in signatures):
        raise FileValidationError(f"File content does not match the .{ext} extension.", 415)
    if ext == "webp" and data[8:12] != b"WEBP":
        raise FileValidationError("File content does not match the .webp extension.", 415)


def _check_pdf(data: bytes, max_pages: int) -> int:
    import pymupdf as fitz

    if _PDF_ACTIVE_CONTENT.search(data):
        raise FileValidationError("PDF contains active content (JavaScript, launch actions or embedded files).", 422)
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # PyMuPDF raises several error types for corrupt files
        raise FileValidationError(f"PDF could not be parsed: {exc}", 422) from exc
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise FileValidationError("Encrypted or password-protected PDFs are not supported.", 422)
        if doc.page_count == 0:
            raise FileValidationError("PDF has no pages.", 422)
        if doc.page_count > max_pages:
            raise FileValidationError(f"PDF has {doc.page_count} pages; the limit is {max_pages}.", 413)
        return doc.page_count
    finally:
        doc.close()


def _check_image(data: bytes, ext: str, max_pixels: int) -> None:
    from PIL import Image, UnidentifiedImageError

    expected = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP"}[ext]
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format != expected:
                raise FileValidationError(f"Image is {img.format}, not {expected}.", 415)
            width, height = img.size
            if width * height > max_pixels:
                raise FileValidationError("Image dimensions exceed the allowed pixel budget.", 413)
            img.verify()
        # verify() leaves the image unusable; re-open and fully decode to catch truncation.
        with Image.open(io.BytesIO(data)) as img:
            img.load()
    except FileValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise FileValidationError(f"Image could not be decoded: {exc}", 422) from exc


def _check_text(data: bytes) -> None:
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FileValidationError("Text files must be UTF-8 encoded.", 422) from exc
    if b"\x00" in data:
        raise FileValidationError("Text file contains binary data.", 422)


def validate_upload(
    file: FileStorage | None,
    allowed: set[str],
    *,
    max_bytes: int,
    max_pdf_pages: int = 600,
    max_image_pixels: int = 40_000_000,
) -> ValidatedFile:
    """Validate an uploaded file and return its bytes and safe metadata."""
    if file is None or not file.filename:
        raise FileValidationError("No file was provided.")

    original = file.filename
    safe = secure_filename(original)
    ext = extension_of(safe)
    if not safe or not ext:
        raise FileValidationError("Filename is invalid or has no extension.")
    if ext not in allowed:
        raise FileValidationError(
            f"Unsupported file type '.{ext}'. Allowed: {', '.join(sorted(allowed))}.", 415
        )

    data = file.read(max_bytes + 1)
    if not data:
        raise FileValidationError("Uploaded file is empty.")
    if len(data) > max_bytes:
        raise FileValidationError(f"File exceeds the {max_bytes // (1024 * 1024)} MB limit.", 413)

    _check_magic(ext, data)
    if ext == "pdf":
        _check_pdf(data, max_pdf_pages)
    elif ext in IMAGE_EXTENSIONS:
        _check_image(data, ext, max_image_pixels)
    else:
        _check_text(data)

    return ValidatedFile(
        original_name=original[:255],
        safe_name=safe,
        stored_name=f"{uuid.uuid4().hex}.{ext}",
        extension=ext,
        mime_type=_MIME.get(ext, "application/octet-stream"),
        data=data,
        sha256=hashlib.sha256(data).hexdigest(),
    )
