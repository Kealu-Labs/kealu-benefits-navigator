"""Generate pre-filled benefit application draft PDFs using only the Python stdlib.

Produces a valid PDF 1.4 document with form-like layout — no external
dependencies required.  The output is a *draft* for user review, not a
legally binding submission.
"""

from __future__ import annotations

import re
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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
        y = _add_text(lines, f"  SSN: ____-____-________  (do NOT pre-fill)", y, size=9)
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


def _parse_programs_from_output(workflow_output: str) -> list[str]:
    """Extract program names from workflow output text."""
    programs = []
    known = [
        "Medicaid", "CHIP", "SNAP", "WIC", "LIHEAP", "Section 8",
        "TANF", "ACA Marketplace", "Head Start", "Free School Lunch",
        "Reduced School Lunch", "NSLP", "Lifeline", "EITC",
    ]
    output_upper = workflow_output.upper()
    for prog in known:
        if prog.upper() in output_upper:
            programs.append(prog)
    return programs or ["(Review workflow output for eligible programs)"]


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
        The text output from the benefit-navigator workflow.
    output_dir:
        Directory to write the PDF to. Defaults to a temp-like location.

    Returns
    -------
    Path to the generated PDF.
    """
    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefit-applications"

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
    filename = f"benefit-application-draft-{zip_code}-{timestamp}.pdf"
    output_path = output_dir / filename
    pdf.write(output_path)

    return output_path
