"""Multimodal image-to-document RAG and vision safety guardrails."""
import io

import pytest

from app.guardrails import (REDACTION_NOTICE, VISION_DISCLAIMER, GuardrailReport, contains_identification,
                            sanitize_vision_result, sanitize_vision_text)
from app.vision.analyzer import VISION_SCHEMA, VISION_SYSTEM_PROMPT, heuristic_features
from tests.conftest import FakeLLM

FORBIDDEN = [
    "This is acetone.",
    "The liquid appears to be ethanol.",
    "The sample is likely contaminated with E. coli.",
    "These colonies are consistent with Staphylococcus aureus.",
    "The powder is probably cyanide.",
    "This lesion is indicative of cancer.",
    "Mycoplasma is present in the culture.",
    "The culture shows bacterial contamination.",
    "Likely a fungal infection.",
]
ALLOWED = [
    "The tube contains a clear, colourless liquid filled to the 10 mL mark.",
    "The display shows the text E-104 in red characters.",
    "The medium is cloudy and yellow compared with the reference flask.",
    "Round, cream-coloured colonies about 2 mm in diameter are visible on the plate.",
    "A white precipitate has settled at the bottom of the vial.",
]


@pytest.mark.parametrize("sentence", FORBIDDEN)
def test_identification_claims_are_detected(sentence):
    assert contains_identification(sentence)


@pytest.mark.parametrize("sentence", ALLOWED)
def test_observational_descriptions_are_allowed(sentence):
    assert not contains_identification(sentence)
    assert sanitize_vision_text(sentence) == sentence


def test_sanitizer_redacts_only_offending_sentences():
    report = GuardrailReport()
    text = "The medium is cloudy and yellow. This is likely contaminated with bacteria. A label reads LOT 4471."
    clean = sanitize_vision_text(text, report)
    assert "bacteria" not in clean
    assert REDACTION_NOTICE in clean
    assert "The medium is cloudy and yellow." in clean and "LOT 4471" in clean
    assert report.redactions == 1 and "unverified_identification_redacted" in report.flags


def test_verbatim_display_text_is_preserved():
    report = GuardrailReport()
    result = sanitize_vision_result({
        "visual_description": "An instrument screen with a red banner.",
        "observed_text": ["E-104", "CONTAMINATION DETECTED"],
        "sample_observations": ["The sample is contaminated with mould."],
        "equipment_type": "HPLC system",
        "search_query": "E-104 high pressure",
    }, report)
    assert result["observed_text"] == ["E-104", "CONTAMINATION DETECTED"]
    assert result["sample_observations"] == [REDACTION_NOTICE]
    assert report.redactions == 1


def test_vision_prompt_and_schema_encode_the_guardrails():
    assert "Never state or guess" in VISION_SYSTEM_PROMPT
    assert "verbatim" in VISION_SYSTEM_PROMPT
    assert VISION_SCHEMA["additionalProperties"] is False
    assert set(VISION_SCHEMA["required"]) == set(VISION_SCHEMA["properties"])


def _post_image(client, data, name="photo.png", note=""):
    return client.post("/api/vision/analyze", data={"image": (io.BytesIO(data), name), "note": note},
                       content_type="multipart/form-data")


def test_llm_identifications_are_redacted_end_to_end(client, install_llm, image_factory):
    llm = install_llm(FakeLLM(json_result={
        "visual_description": "A flask of cloudy yellow medium. This is clearly a bacterial contamination with E. coli.",
        "observed_text": [],
        "equipment_type": "cell culture flask",
        "sample_observations": ["Medium is turbid.", "The culture is infected with yeast."],
        "image_quality": "good",
        "search_query": "cloudy yellow medium culture flask",
    }))
    resp = _post_image(client, image_factory("PNG", color=(200, 190, 60)))
    assert resp.status_code == 200
    body = resp.get_json()
    text = body["analysis"]["visual_description"] + " ".join(body["analysis"]["sample_observations"])
    assert "E. coli" not in text and "yeast" not in text
    assert "Medium is turbid." in body["analysis"]["sample_observations"]
    assert body["guardrails"]["redactions"] == 2
    assert body["disclaimer"] == VISION_DISCLAIMER
    assert body["mode"] == "vision-llm"
    # The image is sent to the model together with the guardrail system prompt.
    assert llm.calls[0]["system"] == VISION_SYSTEM_PROMPT
    assert llm.calls[0]["content"][0]["type"] == "image"
    # Description still drives SOP retrieval: the contamination-response page is matched.
    assert any(m["document_title"].startswith("SOP-CC-011") and m["page"] == 3 for m in body["sop_matches"])


def test_error_display_maps_to_sop_and_verified_fix(client, install_llm, image_factory):
    install_llm(FakeLLM(json_result={
        "visual_description": "LCD display on an HPLC pump with a red warning icon.",
        "observed_text": ["E-104", "PRESSURE LIMIT"],
        "equipment_type": "HPLC system",
        "sample_observations": [],
        "image_quality": "good",
        "search_query": "HPLC pump E-104 pressure limit",
    }))
    body = _post_image(client, image_factory(draw_red=True)).get_json()
    assert body["evidence_status"] == "grounded"
    assert body["sop_matches"][0]["document_title"].startswith("SOP-HPLC-004")
    assert body["sop_matches"][0]["page"] == 3
    assert body["troubleshooting"][0]["error_code"] == "E-104"
    assert body["troubleshooting"][0]["verified"] is True


def test_heuristic_mode_when_vision_model_offline(client, image_factory):
    body = _post_image(client, image_factory(draw_red=True), note="centrifuge shows IMB-01").get_json()
    assert body["mode"] == "heuristic"
    assert any("Vision model offline" in w for w in body["guardrails"]["warnings"])
    assert body["features"]["display_like"] is True
    assert body["features"]["red_indicator_fraction"] > 0.01
    assert body["troubleshooting"][0]["error_code"] == "IMB-01"
    assert body["sop_matches"][0]["document_title"].startswith("SOP-CEN-002")


def test_identification_request_in_note_is_flagged(client, image_factory):
    body = _post_image(client, image_factory(), note="What chemical is in this vial?").get_json()
    assert "substance_identification" in body["guardrails"]["flags"]


def test_no_match_reports_missing_evidence(client, image_factory):
    body = _post_image(client, image_factory(color=(128, 128, 128))).get_json()
    assert body["evidence_status"] == "insufficient"
    assert any("No matching SOP" in w for w in body["guardrails"]["warnings"])


def test_heuristic_features_describe_colours(image_factory):
    f = heuristic_features(image_factory(color=(40, 170, 70)))
    assert f["dominant_colours"][0]["name"] == "green"
    assert f["image"] == {"width": 320, "height": 240, "format": "PNG"}


def test_vision_endpoint_rejects_non_images(client, pdf_factory):
    assert _post_image(client, pdf_factory(["x"]), name="scan.pdf").status_code == 415
    assert _post_image(client, b"GIF89a....", name="anim.gif").status_code == 415
    assert client.post("/api/vision/analyze", data={}, content_type="multipart/form-data").status_code == 400
