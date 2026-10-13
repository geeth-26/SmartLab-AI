"""Safety-first guardrails shared by the RAG and vision pipelines.

Two responsibilities:

* **Query screening** - flag questions asking for things the assistant must not
  answer from retrieved text alone (identifying unknown substances, medical
  advice/dosing for people, disabling safety interlocks).
* **Vision output sanitising** - the vision model may *describe* what is visible
  (colours, turbidity, text on a display, equipment parts) but must never assert
  the identity of a chemical, organism, contaminant or medical condition. Any
  sentence that does is redacted and replaced with a notice, and the response is
  flagged so the UI can show it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

VISION_DISCLAIMER = (
    "Visual analysis describes observable features only. It does not identify chemicals, "
    "organisms, contaminants or medical conditions - confirm identity with validated analytical "
    "methods (e.g. HPLC, MS, PCR, culture) and your lab's SOPs."
)
REDACTION_NOTICE = "[Redacted: unverified identification - confirm with a validated analytical method.]"

# Substances, organisms and conditions the vision pipeline must never claim to identify.
_IDENTITY_LEXICON = [
    # chemicals / reagents
    r"acetone", r"ethanol", r"methanol", r"isopropanol", r"chloroform", r"benzene", r"toluene", r"xylene",
    r"formaldehyde", r"formalin", r"cyanide", r"arsenic", r"mercury", r"lead", r"acid", r"base", r"bleach",
    r"hypochlorite", r"peroxide", r"ammonia", r"phenol", r"dmso", r"trizol", r"guanidin\w*", r"sodium \w+",
    r"potassium \w+", r"hydrochloric", r"sulfuric", r"nitric", r"opioid\w*", r"fentanyl", r"cocaine",
    r"toxin\w*", r"poison\w*", r"explosive\w*", r"solvent", r"compound \w+",
    # organisms / contaminants
    r"e\.? ?coli", r"escherichia", r"salmonella", r"staphylococc\w*", r"streptococc\w*", r"pseudomonas",
    r"mycoplasma", r"bacteri\w*", r"fung\w*", r"yeast", r"mold", r"mould", r"virus\w*", r"viral",
    r"pathogen\w*", r"contaminat\w*", r"infect\w*", r"aspergillus", r"candida",
    # medical
    r"disease", r"diagnos\w*", r"cancer\w*", r"tumou?r\w*", r"malignan\w*", r"lesion\w*", r"symptom\w*",
    r"overdose", r"lethal", r"toxic\w*",
]
_IDENTITY = r"(?:" + "|".join(_IDENTITY_LEXICON) + r")"

# Assertive identification phrasing followed (within a few words) by an identity term.
_ASSERTION_PATTERNS = [
    rf"\b(?:this|it|the (?:sample|substance|liquid|powder|solid|culture|colony|colonies|growth|residue|precipitate|material|tissue))"
    rf"\s+(?:is|are|appears to be|looks like|seems to be|is likely|is probably|is most likely|contains|shows|indicates)\b[^.]{{0,60}}?\b{_IDENTITY}\b",
    rf"\b(?:identified|identify|identifies|consistent with|indicative of|diagnostic of|positive for|confirms?|confirmed)\b[^.]{{0,60}}?\b{_IDENTITY}\b",
    rf"\b(?:likely|probably|possibly|presumably|definitely|clearly)\s+(?:a |an |the )?{_IDENTITY}\b",
    rf"\b{_IDENTITY}\b[^.]{{0,30}}\b(?:is present|are present|detected|identified)\b",
]
_ASSERTION_RE = [re.compile(p, re.IGNORECASE) for p in _ASSERTION_PATTERNS]
# Sentence boundary: terminal punctuation followed by an upper-case start, so "E. coli" stays intact.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(\[])|\n+")

# Query screening rules: (code, regex, user-facing warning)
_QUERY_RULES = [
    (
        "substance_identification",
        re.compile(r"\b(what|which|identify|tell me)\b.{0,40}\b(chemical|substance|compound|powder|liquid|"
                   r"contaminant|organism|bacteri\w*|microbe)\b.{0,30}\b(is (this|it)|in (this|the|that)( \w+)? "
                   r"(image|photo|picture|vial|tube|flask|bottle|container|sample|beaker))"
                   r"|\bwhat\b.{0,15}\b(is|are) (this|these|that)\b.{0,20}\b(powder|liquid|substance|chemical|"
                   r"crystals|residue|growth|colony|colonies)\b",
                   re.IGNORECASE),
        "SmartLab AI cannot identify unknown substances or organisms. Use validated analytical methods "
        "and treat unlabelled materials as hazardous per your chemical hygiene plan.",
    ),
    (
        "medical_advice",
        re.compile(r"\b(dose|dosage|dosing|mg/kg|administer|inject|ingest|swallow\w*|treat(ment)?|diagnos\w*)\b"
                   r".{0,40}\b(human|patient|person|people|me|myself|child|someone)\b|\b(i|someone|colleague) "
                   r"(was|got|have been|has been) (exposed|splashed|cut|burned|burnt)\b", re.IGNORECASE),
        "SmartLab AI does not give medical or dosing advice for people. For exposures follow your SDS "
        "first-aid section, use the eyewash/safety shower, and contact occupational health or emergency services.",
    ),
    (
        "safety_bypass",
        re.compile(r"\b(bypass|disable|override|defeat|turn off|jumper)\b.{0,40}\b(interlock|safety|alarm|"
                   r"sash|lid lock|sensor)\b", re.IGNORECASE),
        "Safety interlocks and alarms must not be bypassed. Contact the equipment owner or EHS.",
    ),
]


@dataclass
class GuardrailReport:
    flags: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    redactions: int = 0

    @property
    def blocked(self) -> bool:
        return bool(self.flags)

    def to_dict(self) -> dict:
        return {"flags": self.flags, "warnings": self.warnings, "redactions": self.redactions}


def screen_query(text: str) -> GuardrailReport:
    report = GuardrailReport()
    for code, pattern, warning in _QUERY_RULES:
        if pattern.search(text or ""):
            report.flags.append(code)
            report.warnings.append(warning)
    return report


def contains_identification(text: str) -> bool:
    return any(p.search(text or "") for p in _ASSERTION_RE)


def sanitize_vision_text(text: str, report: GuardrailReport | None = None) -> str:
    """Redact sentences that assert the identity of a substance, organism or condition."""
    report = report if report is not None else GuardrailReport()
    if not text:
        return text
    out: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text):
        if contains_identification(sentence):
            report.redactions += 1
            if out and out[-1] == REDACTION_NOTICE:
                continue
            out.append(REDACTION_NOTICE)
        else:
            stripped = sentence.strip()
            if stripped:
                out.append(stripped)
    if report.redactions and "unverified_identification_redacted" not in report.flags:
        report.flags.append("unverified_identification_redacted")
        report.warnings.append(
            "Part of the visual description was withheld because it attempted an unverified "
            "chemical, biological or medical identification."
        )
    return " ".join(out)


def sanitize_vision_result(result: dict, report: GuardrailReport) -> dict:
    """Apply :func:`sanitize_vision_text` to every free-text field of a vision result."""
    clean = dict(result)
    for key in ("visual_description", "equipment_type", "search_query"):
        if isinstance(clean.get(key), str):
            clean[key] = sanitize_vision_text(clean[key], report)
    # observed_text is verbatim text read off a display/label (e.g. an instrument's own
    # "CONTAMINATION DETECTED" message), not an identification made by the model, so it is kept.
    for key in ("sample_observations",):
        if isinstance(clean.get(key), list):
            items = [sanitize_vision_text(str(item), report) for item in clean[key]]
            clean[key] = [i for i in items if i]
    return clean
