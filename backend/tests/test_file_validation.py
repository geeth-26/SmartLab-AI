"""Secure file validation pipeline."""
import io

import pytest
from werkzeug.datastructures import FileStorage

from app.security import (DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, SHARED_EXTENSIONS, FileValidationError,
                          validate_upload)

MB = 1024 * 1024


def fs(data: bytes, name: str) -> FileStorage:
    return FileStorage(stream=io.BytesIO(data), filename=name)


def test_valid_pdf_passes(pdf_factory):
    data = pdf_factory(["Hello world. This is page one."])
    v = validate_upload(fs(data, "manual.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)
    assert v.extension == "pdf" and v.mime_type == "application/pdf"
    assert v.stored_name.endswith(".pdf") and v.stored_name != "manual.pdf"
    assert len(v.sha256) == 64


def test_path_traversal_filename_is_sanitised(pdf_factory):
    v = validate_upload(fs(pdf_factory(["x"]), "../../etc/passwd.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)
    assert "/" not in v.safe_name and ".." not in v.safe_name
    assert v.stored_name.count(".") == 1  # random hex + extension only


@pytest.mark.parametrize("upload", [None, FileStorage(stream=io.BytesIO(b""), filename="")])
def test_missing_file_rejected(upload):
    with pytest.raises(FileValidationError, match="No file"):
        validate_upload(upload, DOCUMENT_EXTENSIONS, max_bytes=MB)


def test_empty_file_rejected():
    with pytest.raises(FileValidationError, match="empty"):
        validate_upload(fs(b"", "a.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)


def test_disallowed_extension_rejected():
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(b"MZ\x90\x00", "tool.exe"), DOCUMENT_EXTENSIONS, max_bytes=MB)
    assert exc.value.status == 415


def test_extension_spoofing_detected(image_factory):
    png = image_factory("PNG")
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(png, "fake.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)
    assert exc.value.status == 415


def test_jpeg_disguised_as_png_rejected(image_factory):
    jpg = image_factory("JPEG")
    with pytest.raises(FileValidationError):
        validate_upload(fs(jpg, "photo.png"), IMAGE_EXTENSIONS, max_bytes=MB)


def test_oversized_file_rejected(pdf_factory):
    data = pdf_factory(["x" * 2000] * 3)
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(data, "big.pdf"), DOCUMENT_EXTENSIONS, max_bytes=len(data) - 1)
    assert exc.value.status == 413


def test_corrupt_pdf_rejected():
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(b"%PDF-1.7\nthis is not really a pdf", "bad.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)
    assert exc.value.status == 422


def test_pdf_with_javascript_rejected(pdf_factory):
    data = pdf_factory(["Click me"]).replace(b"%%EOF", b"/JavaScript (app.alert(1))\n%%EOF")
    with pytest.raises(FileValidationError, match="active content"):
        validate_upload(fs(data, "evil.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)


def test_encrypted_pdf_rejected():
    import pymupdf
    doc = pymupdf.open()
    doc.new_page().insert_text((50, 50), "secret")
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
    with pytest.raises(FileValidationError, match="Encrypted"):
        validate_upload(fs(data, "locked.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB)


def test_pdf_page_limit_enforced(pdf_factory):
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(pdf_factory(["a", "b", "c"]), "long.pdf"), DOCUMENT_EXTENSIONS, max_bytes=MB, max_pdf_pages=2)
    assert exc.value.status == 413


def test_truncated_image_rejected(image_factory):
    data = image_factory("PNG")[:200]
    with pytest.raises(FileValidationError):
        validate_upload(fs(data, "cut.png"), IMAGE_EXTENSIONS, max_bytes=MB)


def test_decompression_bomb_guard(image_factory):
    with pytest.raises(FileValidationError) as exc:
        validate_upload(fs(image_factory(size=(400, 400)), "huge.png"), IMAGE_EXTENSIONS, max_bytes=MB,
                        max_image_pixels=10_000)
    assert exc.value.status == 413


def test_text_must_be_utf8():
    with pytest.raises(FileValidationError, match="UTF-8"):
        validate_upload(fs("é".encode("latin-1") * 5, "notes.txt"), SHARED_EXTENSIONS, max_bytes=MB)
    ok = validate_upload(fs(b"a,b\n1,2\n", "data.csv"), SHARED_EXTENSIONS, max_bytes=MB)
    assert ok.mime_type == "text/csv"


def test_upload_endpoint_returns_json_errors(client):
    resp = client.post("/api/documents", data={"file": (io.BytesIO(b"hello"), "x.docx")},
                       content_type="multipart/form-data")
    assert resp.status_code == 415
    assert "Unsupported file type" in resp.get_json()["error"]
