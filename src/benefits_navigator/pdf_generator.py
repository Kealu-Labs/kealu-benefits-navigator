"""Generate benefit application PDFs.

Two generation paths live here:

- ``generate_application_pdf`` — the universal worksheet fallback. Renders a
  stdlib-only PDF 1.4 draft (no external dependencies) for any state, used by
  ``form_filler.generate_application`` when no official fillable template is
  available.
- ``generate_official_medical_pdf`` — downloads and prefills the official
  California Medi-Cal single-stream application. Requires ``pypdf`` and an
  LLM-supplied ``application_field_plan``; pypdf is imported lazily so the
  worksheet path keeps working without it.
"""

from __future__ import annotations

import json
import re
import textwrap
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_CA_MEDI_CAL_APPLICATION_URLS = (
    "https://www.coveredca.com/pdfs/paper-application/CA-SingleStreamApp_92MAX.pdf",
    "https://www.dhcs.ca.gov/services/medi-cal/eligibility/Documents/"
    "2014_CoveredCA_Applications/ENG-CASingleStreamApp.pdf",
)

# Sensitive-field detection is token-based (word boundaries), not substring
# based: "designed", "assign_to", or "salient" must NOT be flagged, while
# "rep_sign", "date_signed", "ssn_1", or "alien_number" must be. Phrases cover
# multi-word markers that survive tokenization boundaries.
_SENSITIVE_FIELD_TOKENS = frozenset({
    "ssn",
    "sign",
    "signed",
    "signature",
    "alien",
    "alein",
    "imdoc",
})

_SENSITIVE_FIELD_PHRASES = (
    "social security",
    "document number",
    "document_number",
)


def _contains_sensitive_marker(text: str) -> bool:
    normalized = text.strip().lower()
    if any(phrase in normalized for phrase in _SENSITIVE_FIELD_PHRASES):
        return True
    tokens = re.split(r"[^a-z0-9]+", normalized)
    return any(token in _SENSITIVE_FIELD_TOKENS for token in tokens)


class MissingApplicationInformation(ValueError):
    """Raised when one required non-sensitive application answer is missing."""

    def __init__(self, key: str, question: str) -> None:
        self.key = key
        self.question = question
        super().__init__(question)


def _parse_programs_from_output(workflow_output: str) -> list[str]:
    """Extract program names from workflow output text."""
    programs = []
    known = [
        "Medicaid", "Medi-Cal", "CHIP", "SNAP", "CalFresh", "WIC", "LIHEAP",
        "Section 8", "TANF", "ACA Marketplace", "Head Start",
        "Free School Lunch", "Reduced School Lunch", "NSLP", "Lifeline", "EITC",
    ]
    output_upper = workflow_output.upper()
    for prog in known:
        if prog.upper() in output_upper:
            programs.append(prog)
    return programs or ["(Review workflow output for eligible programs)"]


def _split_name(full_name: str) -> tuple[str, str, str]:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    if len(parts) == 2:
        return parts[0], "", parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _none_to_blank(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.lower() in {"none", "n/a", "not applicable"} else text


def _is_sensitive_pdf_field(field_name: str) -> bool:
    return _contains_sensitive_marker(field_name)


def _plan_item_is_sensitive(item: dict[str, Any]) -> bool:
    if bool(item.get("sensitive")):
        return True

    semantic_text = " ".join(
        str(item.get(key) or "")
        for key in ("profile_key", "question", "label", "description")
    )
    if _contains_sensitive_marker(semantic_text):
        return True

    field_names: list[str] = []
    pdf_fields = item.get("pdf_fields") or []
    if isinstance(pdf_fields, str):
        field_names.append(pdf_fields)
    elif isinstance(pdf_fields, list):
        field_names.extend(str(field) for field in pdf_fields)

    for key in ("yes_field", "no_field"):
        field_name = item.get(key)
        if field_name:
            field_names.append(str(field_name))

    choices = item.get("choices") or {}
    if isinstance(choices, dict):
        field_names.extend(str(field) for field in choices.values())

    return any(_is_sensitive_pdf_field(name) for name in field_names)


def _json_safe_pdf_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_safe_pdf_value(item) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _json_safe_pdf_value(item)
            for key, item in value.items()
        }
    return str(value)


def load_application_profile(path: Path) -> dict[str, Any]:
    """Load saved application answers from JSON."""
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as profile_file:
        data = json.load(profile_file)
    if not isinstance(data, dict):
        raise ValueError("Application profile JSON must contain an object.")
    return data


def save_application_profile(path: Path, profile: dict[str, Any]) -> None:
    """Persist collected non-sensitive answers as JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as profile_file:
        json.dump(profile, profile_file, indent=2, ensure_ascii=False)
        profile_file.write("\n")


def _get_profile_value(profile: dict[str, Any], dotted_key: str) -> Any:
    value: Any = profile
    for part in dotted_key.split("."):
        if isinstance(value, list):
            try:
                value = value[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return None
    return value


def _set_profile_value(profile: dict[str, Any], dotted_key: str, value: Any) -> None:
    parts = dotted_key.split(".")
    target: Any = profile

    for index, part in enumerate(parts[:-1]):
        next_part = parts[index + 1]
        if isinstance(target, list):
            list_index = int(part)
            while len(target) <= list_index:
                target.append({} if not next_part.isdigit() else [])
            target = target[list_index]
        else:
            if part not in target or not isinstance(target[part], (dict, list)):
                target[part] = [] if next_part.isdigit() else {}
            target = target[part]

    final_part = parts[-1]
    if isinstance(target, list):
        list_index = int(final_part)
        while len(target) <= list_index:
            target.append(None)
        target[list_index] = value
    else:
        target[final_part] = value


def next_application_question(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
) -> tuple[str, str] | None:
    """Return exactly one missing required non-sensitive question."""
    for item in field_plan:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("required", True)):
            continue
        if _plan_item_is_sensitive(item):
            continue

        key = str(item.get("profile_key") or "").strip()
        question = str(item.get("question") or "").strip()
        if not key or not question:
            continue

        value = _get_profile_value(profile, key)
        if value is None or value == "":
            return key, question

    return None


def record_application_answer(
    path: Path,
    key: str,
    answer: str,
    field_plan: list[dict[str, Any]],
) -> dict[str, Any]:
    """Save one answer unless its field is sensitive."""
    matching_item = next(
        (
            item
            for item in field_plan
            if isinstance(item, dict)
            and str(item.get("profile_key") or "").strip() == key
        ),
        None,
    )
    if matching_item is None:
        raise KeyError(f"Unknown application question key: {key}")
    if _plan_item_is_sensitive(matching_item):
        raise ValueError(
            "Sensitive information such as Social Security numbers, immigration "
            "document numbers, and signatures must be entered directly into the PDF."
        )

    profile = load_application_profile(path)
    _set_profile_value(profile, key, answer.strip())
    save_application_profile(path, profile)
    return profile


def require_complete_application_profile(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
) -> None:
    """Raise with one missing non-sensitive question."""
    missing = next_application_question(profile, field_plan)
    if missing is not None:
        key, question = missing
        raise MissingApplicationInformation(key, question)


def inspect_pdf_form(pdf_path: Path) -> list[dict[str, Any]]:
    """Inspect the real official PDF and return its fillable field inventory."""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    inventory: list[dict[str, Any]] = []
    for name, field in (reader.get_fields() or {}).items():
        inventory.append(
            {
                "name": name,
                "field_type": str(field.get("/FT") or ""),
                "options": _json_safe_pdf_value(field.get("/Opt")),
                "sensitive": _is_sensitive_pdf_field(name),
            }
        )
    return inventory


def _extract_values(args: dict[str, Any]) -> dict[str, str]:
    application_data = args.get("application_data") or {}
    if not isinstance(application_data, dict):
        raise ValueError("application_data must be a dictionary.")

    merged_args = {**args, **application_data}
    profile = str(merged_args.get("household_profile") or "")
    zip_code = str(merged_args.get("zip_code") or "").strip()
    if not zip_code:
        match = re.search(r"\b(\d{5})\b", profile)
        if match:
            zip_code = match.group(1)

    return {
        "state": str(merged_args.get("state") or "CA").strip().upper(),
        "zip_code": zip_code,
    }


def _download_template(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    for url in _CA_MEDI_CAL_APPLICATION_URLS:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 Kealu-Benefits-Navigator/1.0",
                "Accept": "application/pdf,*/*;q=0.8",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_type = response.headers.get_content_type()
                data = response.read()
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            continue

        if data.startswith(b"%PDF-"):
            destination.write_bytes(data)
            return

        errors.append(
            f"{url}: returned {content_type!r} with header {data[:16]!r}"
        )

    raise RuntimeError(
        "None of the official California application sources returned a valid PDF. "
        + " | ".join(errors)
    )


def _field_values_from_plan(
    profile: dict[str, Any],
    field_plan: list[dict[str, Any]],
    available_fields: set[str],
) -> dict[str, str]:
    """Convert the AI field plan into real PDF field values."""
    values: dict[str, str] = {}

    for item in field_plan:
        if not isinstance(item, dict) or _plan_item_is_sensitive(item):
            continue

        profile_key = str(item.get("profile_key") or "").strip()
        kind = str(item.get("kind") or "text").strip().lower()
        pdf_fields = item.get("pdf_fields") or []
        if isinstance(pdf_fields, str):
            pdf_fields = [pdf_fields]
        if not profile_key or not isinstance(pdf_fields, list):
            continue

        safe_fields = [
            str(field_name)
            for field_name in pdf_fields
            if str(field_name) in available_fields
            and not _is_sensitive_pdf_field(str(field_name))
        ]
        profile_value = _get_profile_value(profile, profile_key)
        if profile_value is None or profile_value == "":
            continue

        if kind == "full_name":
            first, middle, last = _split_name(str(profile_value))
            for field_name, part in zip(safe_fields, (first, middle, last)):
                if part:
                    values[field_name] = part
            continue

        if kind == "yes_no":
            normalized = str(profile_value).strip().lower()
            selected = item.get("yes_field") if normalized in {"yes", "y", "true", "1"} else item.get("no_field")
            if selected and str(selected) in available_fields and not _is_sensitive_pdf_field(str(selected)):
                values[str(selected)] = str(item.get("on_value") or "/Yes")
            continue

        if kind in {"choice", "multi_choice"}:
            choices = item.get("choices") or {}
            selected_values = profile_value if isinstance(profile_value, list) else [profile_value]
            if isinstance(choices, dict):
                for selected_value in selected_values:
                    selected = choices.get(str(selected_value).strip().lower())
                    if selected and str(selected) in available_fields and not _is_sensitive_pdf_field(str(selected)):
                        values[str(selected)] = str(item.get("on_value") or "/Yes")
            continue

        text = _none_to_blank(profile_value)
        if text:
            for field_name in safe_fields:
                values[field_name] = text

    return values


def generate_official_medical_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Download, inspect, validate, and prefill the official Medi-Cal PDF.

    Requires an LLM-supplied ``application_field_plan`` in *args*; callers
    without one should use ``generate_application_pdf`` (the worksheet path).
    """
    field_plan = args.get("application_field_plan")
    if not isinstance(field_plan, list) or not field_plan:
        raise ValueError("application_field_plan must be a non-empty list.")

    profile_path_value = args.get("application_profile_path")
    if profile_path_value:
        profile = load_application_profile(Path(str(profile_path_value)))
    else:
        profile = args.get("application_data") or {}
    if not isinstance(profile, dict):
        raise ValueError("application_data must be a dictionary.")

    require_complete_application_profile(profile, field_plan)
    args = {**args, "application_data": profile}

    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"

    values = _extract_values(args)
    if values["state"] != "CA":
        raise NotImplementedError(
            f"Official application generation is not implemented for {values['state'] or 'the selected state'}."
        )

    programs = _parse_programs_from_output(workflow_output)
    if not any(program.upper() in {"MEDICAID", "MEDI-CAL"} for program in programs):
        raise NotImplementedError(
            "CalFresh and WIC require separate official California application workflows."
        )

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    zip_code = values["zip_code"] or "unknown"
    output_dir.mkdir(parents=True, exist_ok=True)

    template_path = output_dir / "official-ca-medi-cal-template.pdf"
    output_path = output_dir / f"official-ca-medi-cal-{zip_code}-{timestamp}.pdf"
    inventory_path = output_dir / "official-ca-medi-cal-field-inventory.json"

    _download_template(template_path)
    field_inventory = inspect_pdf_form(template_path)
    inventory_path.write_text(
        json.dumps(field_inventory, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(template_path))
    available_fields = set((reader.get_fields() or {}).keys())
    requested_fields = _field_values_from_plan(profile, field_plan, available_fields)
    if not requested_fields:
        raise RuntimeError(
            "The field plan did not produce any safe values matching the official PDF."
        )

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    for page in writer.pages:
        writer.update_page_form_field_values(
            page,
            requested_fields,
            auto_regenerate=True,
        )

    with output_path.open("wb") as output_file:
        writer.write(output_file)

    output_path.with_suffix(".review.txt").write_text(
        "Review every page before submitting.\n"
        "Social Security numbers, immigration document numbers, signatures, and signature dates were intentionally left blank.\n"
        "Enter those items directly into the PDF, then verify every answer, sign, and date the application.\n",
        encoding="utf-8",
    )

    return output_path


# ---------------------------------------------------------------------------
# Low-level PDF helpers (raw PDF 1.4 spec)
# ---------------------------------------------------------------------------


class _PdfWriter:
    """Minimal PDF writer that supports text pages with basic formatting."""

    def __init__(self) -> None:
        # Slots: 0=unused, 1=reserved(Pages), 2=reserved(Font)
        # Pre-allocate so add_page() starts at obj 3+
        self._objects: list[bytes] = [b"", b"", b""]
        self._pages: list[int] = []

    def _add_obj(self, data: bytes) -> int:
        self._objects.append(data)
        return len(self._objects) - 1

    def add_page(self, lines: list[tuple[str, float, float, float]]) -> None:
        """Add a page with positioned text lines.

        Each line is (text, x, y, font_size).
        """
        stream_parts: list[str] = []
        for text, x, y, size in lines:
            escaped = (
                text.replace("\\", "\\\\")
                .replace("(", "\\(")
                .replace(")", "\\)")
            )
            stream_parts.append(f"BT /F1 {size:.0f} Tf {x:.1f} {y:.1f} Td ({escaped}) Tj ET")

        stream = "\n".join(stream_parts)
        stream_bytes = stream.encode("latin-1", errors="replace")

        stream_obj = self._add_obj(
            b"<< /Length " + str(len(stream_bytes)).encode() + b" >>\nstream\n"
            + stream_bytes + b"\nendstream"
        )

        page_obj = self._add_obj(
            b"<< /Type /Page /Parent 1 0 R"
            b" /MediaBox [0 0 612 792]"
            b" /Contents " + str(stream_obj).encode() + b" 0 R"
            b" /Resources << /Font << /F1 2 0 R >> >> >>"
        )
        self._pages.append(page_obj)

    def write(self, path: Path) -> None:
        """Write the PDF to *path*."""
        # Slot 1 = Pages, Slot 2 = Font (reserved in __init__)
        kids = " ".join(f"{p} 0 R" for p in self._pages)
        self._objects[1] = (
            f"<< /Type /Pages /Kids [{kids}] /Count {len(self._pages)} >>".encode()
        )
        self._objects[2] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

        catalog = self._add_obj(b"<< /Type /Catalog /Pages 1 0 R >>")

        # Serialize
        buf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: list[int] = [0] * len(self._objects)

        for i in range(1, len(self._objects)):
            offsets[i] = len(buf)
            buf.extend(f"{i} 0 obj\n".encode())
            buf.extend(self._objects[i])
            buf.extend(b"\nendobj\n")

        xref_offset = len(buf)
        buf.extend(f"xref\n0 {len(self._objects)}\n".encode())
        buf.extend(b"0000000000 65535 f\r\n")
        for i in range(1, len(self._objects)):
            buf.extend(f"{offsets[i]:010d} 00000 n\r\n".encode())

        buf.extend(
            f"trailer\n<< /Size {len(self._objects)} /Root {catalog} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n".encode()
        )

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(buf))


# ---------------------------------------------------------------------------
# Page layout helpers
# ---------------------------------------------------------------------------

_PAGE_W = 612  # Letter width in points
_PAGE_H = 792
_MARGIN_L = 54
_MARGIN_R = 54
_MARGIN_TOP = 54
_USABLE_W = _PAGE_W - _MARGIN_L - _MARGIN_R
_LINE_HEIGHT_BODY = 14
_LINE_HEIGHT_HEADING = 20


def _wrap(text: str, width: int = 80) -> list[str]:
    """Word-wrap text to fit page width."""
    return textwrap.wrap(text, width=width) or [""]


def _add_text(
    lines: list[tuple[str, float, float, float]],
    text: str,
    y: float,
    *,
    size: float = 10,
    x: float = _MARGIN_L,
    bold: bool = False,
) -> float:
    """Append wrapped text lines, return new y position."""
    if bold:
        size += 1  # Helvetica has no bold variant in base 14; simulate with size
    wrapped = _wrap(text, width=int(_USABLE_W / (size * 0.5)))
    lh = _LINE_HEIGHT_HEADING if size > 12 else _LINE_HEIGHT_BODY
    for line_text in wrapped:
        lines.append((line_text, x, y, size))
        y -= lh
    return y


# ---------------------------------------------------------------------------
# Application form content builders
# ---------------------------------------------------------------------------


def _build_header_page(
    household: dict[str, Any],
    programs: list[str],
    generated_at: str,
) -> list[tuple[str, float, float, float]]:
    """Build the cover/header page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "BENEFIT APPLICATION DRAFT", y, size=18, bold=True)
    y -= 8
    y = _add_text(lines, "*** DRAFT FOR REVIEW - NOT A FINAL SUBMISSION ***", y, size=12, bold=True)
    y -= 20

    y = _add_text(lines, f"Generated: {generated_at}", y, size=9)
    y = _add_text(lines, "Source: Kealu Benefit Navigator (AI-assisted)", y, size=9)
    y -= 16

    # Applicant information section
    y = _add_text(lines, "APPLICANT INFORMATION", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    fields = [
        ("Full Name", household.get("name", "________________________")),
        ("Date of Birth", household.get("dob", "____/____/________")),
        ("Address", household.get("address", "________________________________________")),
        ("City, State, ZIP", f"{household.get('city', '_____________')}, "
                             f"{household.get('state', '____')} "
                             f"{household.get('zip_code', '_________')}"),
        ("Phone", household.get("phone", "(____) ____-________")),
        ("Email", household.get("email", "________________________________")),
        ("Household Size", str(household.get("household_size", "____"))),
        ("Annual Income", f"${household.get('income', '____________')}"),
        ("Income Type", household.get("income_type", "________________________")),
    ]

    for label, value in fields:
        y = _add_text(lines, f"{label}:  {value}", y, size=10)
        y -= 2

    y -= 16
    y = _add_text(lines, "PROGRAMS APPLIED FOR", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    for i, program in enumerate(programs, 1):
        y = _add_text(lines, f"  [{i}]  {program}", y, size=11)
        y -= 2

    y -= 24
    y = _add_text(
        lines,
        "IMPORTANT: This is an AI-generated draft based on information you provided. "
        "Review all pre-filled fields carefully before submitting to any agency. "
        "Eligibility determinations are estimates and subject to official verification.",
        y,
        size=9,
    )

    return lines


def _build_household_page(
    members: list[dict[str, Any]],
) -> list[tuple[str, float, float, float]]:
    """Build household members page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "HOUSEHOLD MEMBERS", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    for i, member in enumerate(members, 1):
        y = _add_text(lines, f"Member {i}:", y, size=11, bold=True)
        y -= 2
        y = _add_text(lines, f"  Name: {member.get('name', '________________________')}", y)
        y = _add_text(lines, f"  Relationship: {member.get('relationship', '________________')}", y)
        y = _add_text(lines, f"  Age: {member.get('age', '____')}    DOB: {member.get('dob', '____/____/________')}", y)
        y = _add_text(lines, "  SSN: ____-____-________  (do NOT pre-fill)", y, size=9)
        y = _add_text(lines, f"  Health Conditions: {member.get('health_needs', '________________________________')}", y)
        y -= 12

        if y < _MARGIN_TOP + 80:
            break  # prevent overflow

    return lines


def _build_documents_page(
    documents: list[str],
) -> list[tuple[str, float, float, float]]:
    """Build required documents checklist page."""
    lines: list[tuple[str, float, float, float]] = []
    y = _PAGE_H - _MARGIN_TOP

    y = _add_text(lines, "REQUIRED DOCUMENTS CHECKLIST", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 16

    y = _add_text(
        lines,
        "Gather these documents before submitting your application:",
        y,
        size=10,
    )
    y -= 8

    for doc in documents:
        y = _add_text(lines, f"  [ ]  {doc}", y, size=10)
        y -= 4
        if y < _MARGIN_TOP + 40:
            break

    y -= 20
    y = _add_text(lines, "APPLICANT SIGNATURE", y, size=14, bold=True)
    y -= 4
    lines.append(("_" * 80, _MARGIN_L, y, 8))
    y -= 20

    y = _add_text(
        lines,
        "I certify that the information provided is true and correct to the best of "
        "my knowledge. I understand that providing false information may result in "
        "denial of benefits and potential legal consequences.",
        y,
        size=9,
    )
    y -= 20

    y = _add_text(lines, "Signature: ________________________________________    Date: ____/____/________", y)
    y -= 16
    y = _add_text(lines, "Print Name: ________________________________________", y)

    return lines


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------



def _parse_documents_from_output(workflow_output: str) -> list[str]:
    """Extract document requirements from workflow output."""
    documents = []
    # Look for common document mentions
    doc_patterns = [
        (r"(?:proof of |verify )?income", "Proof of income (pay stubs, tax return, W-2)"),
        (r"(?:birth certificate|proof of age)", "Birth certificates for all household members"),
        (r"(?:social security|SSN|SS card)", "Social Security cards for all household members"),
        (r"(?:photo id|driver.?s? license|state id)", "Government-issued photo ID"),
        (r"(?:proof of )?residen(?:ce|cy)", "Proof of residency (utility bill, lease agreement)"),
        (r"(?:immigration|citizenship|naturalization)", "Proof of citizenship or immigration status"),
        (r"(?:bank statement|financial|asset)", "Bank statements (last 3 months)"),
        (r"(?:rent|mortgage|housing)", "Housing cost documentation (lease, mortgage statement)"),
        (r"(?:medical|health) record", "Medical records or physician statements"),
        (r"(?:cobra|employer|coverage).{0,20}(?:letter|notice)", "Coverage loss documentation (COBRA notice, termination letter)"),
        (r"(?:child care|daycare)", "Child care expense documentation"),
        (r"(?:disability|SSI|SSDI)", "Disability determination letter (if applicable)"),
    ]

    output_lower = workflow_output.lower()
    for pattern, doc_name in doc_patterns:
        if re.search(pattern, output_lower):
            documents.append(doc_name)

    if not documents:
        # Provide standard set
        documents = [
            "Proof of income (pay stubs, tax return, W-2)",
            "Birth certificates for all household members",
            "Social Security cards for all household members",
            "Government-issued photo ID",
            "Proof of residency (utility bill, lease agreement)",
        ]

    return documents


def _parse_household_from_args(args: dict[str, Any]) -> dict[str, Any]:
    """Extract structured household data from tool arguments."""
    profile = args.get("household_profile", "")
    household: dict[str, Any] = {}

    # Extract ZIP
    zip_match = re.search(r"\b(\d{5})\b", args.get("zip_code", "") or profile)
    if zip_match:
        household["zip_code"] = zip_match.group(1)

    # Extract state
    if args.get("state"):
        household["state"] = args["state"]

    # Extract income — require $ prefix or k/K suffix to avoid false matches
    income_match = re.search(
        r"\$\s*([\d,]+)\s*(?:k|K|/yr|/year|annual|yearly)?"
        r"|(\d[\d,]*)\s*(?:k|K)\b"
        r"|(\d[\d,]+)\s*/(?:yr|year|month|mo)\b",
        profile,
    )
    if income_match:
        raw = (income_match.group(1) or income_match.group(2) or income_match.group(3) or "").replace(",", "")
        if raw:
            amount = int(raw)
            if amount < 1000:
                amount *= 1000  # "42k" -> 42000
            household["income"] = f"{amount:,}"

    # Extract household size
    size_match = re.search(
        r"(?:family of |household.{0,10})(\d+)|(\d+)\s*(?:people|person|member)",
        profile,
        re.IGNORECASE,
    )
    if size_match:
        household["household_size"] = size_match.group(1) or size_match.group(2)

    household["income_type"] = args.get("income_type", "")

    return household


def _parse_members_from_args(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract household member details from profile text."""
    profile = args.get("household_profile", "")
    members: list[dict[str, Any]] = []

    # Try to parse "single parent ... two kids ages 4 and 9" style
    age_pairs = re.findall(r"ages?\s+(\d+)\s+and\s+(\d+)", profile, re.IGNORECASE)
    single_ages = re.findall(r"(\d+)\s*(?:yo|y/o|year.?old)", profile, re.IGNORECASE)

    # Primary applicant
    adult_age = ""
    for a in single_ages:
        if int(a) >= 18:
            adult_age = a
            break

    relationship = "Self (Head of Household)"
    if re.search(r"single (?:parent|mom|mother|dad|father)", profile, re.IGNORECASE):
        relationship = "Self (Single Parent, Head of Household)"

    members.append({
        "name": "",
        "relationship": relationship,
        "age": adult_age,
        "health_needs": args.get("health_needs", ""),
    })

    # Children
    child_num = 1
    for pair in age_pairs:
        for age in pair:
            if int(age) < 19:
                members.append({
                    "name": "",
                    "relationship": f"Child {child_num}",
                    "age": age,
                    "health_needs": "",
                })
                child_num += 1

    # Any single ages that are children
    for age in single_ages:
        if int(age) < 19 and not any(m["age"] == age for m in members):
            members.append({
                "name": "",
                "relationship": f"Child {child_num}",
                "age": age,
                "health_needs": "",
            })
            child_num += 1

    return members


def generate_application_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Generate a pre-filled benefit application draft PDF.

    Parameters
    ----------
    args:
        The original tool arguments (household_profile, state, zip_code, etc.)
    workflow_output:
        The text output from the benefits-navigator workflow.
    output_dir:
        Directory to write the PDF to. Defaults to a temp-like location.

    Returns
    -------
    Path to the generated PDF.
    """
    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefits-applications"

    now = datetime.now(tz=timezone.utc)
    generated_at = now.strftime("%B %d, %Y at %H:%M UTC")
    timestamp = now.strftime("%Y%m%d-%H%M%S")

    household = _parse_household_from_args(args)
    members = _parse_members_from_args(args)
    programs = _parse_programs_from_output(workflow_output)
    documents = _parse_documents_from_output(workflow_output)

    pdf = _PdfWriter()
    pdf.add_page(_build_header_page(household, programs, generated_at))
    pdf.add_page(_build_household_page(members))
    pdf.add_page(_build_documents_page(documents))

    zip_code = household.get("zip_code", "unknown")
    filename = f"benefits-application-draft-{zip_code}-{timestamp}.pdf"
    output_path = output_dir / filename
    pdf.write(output_path)

    return output_path
