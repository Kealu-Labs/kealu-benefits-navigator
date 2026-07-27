"""Generate official state benefit application PDFs."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

_CA_MEDI_CAL_APPLICATION_URLS = (
    "https://www.coveredca.com/pdfs/paper-application/CA-SingleStreamApp_92MAX.pdf",
    "https://www.dhcs.ca.gov/services/medi-cal/eligibility/Documents/"
    "2014_CoveredCA_Applications/ENG-CASingleStreamApp.pdf",
)

_SENSITIVE_FIELD_MARKERS = (
    "ssn",
    "social security",
    "signature",
    "signed",
    "sign_",
    "rep_sign",
    "date_signed",
    "alien",
    "alein",
    "imdoc__num",
    "document_number",
)


class MissingApplicationInformation(ValueError):
    """Raised when one required non-sensitive application answer is missing."""

    def __init__(self, key: str, question: str) -> None:
        self.key = key
        self.question = question
        super().__init__(question)


def _parse_programs_from_output(workflow_output: str) -> list[str]:
    known = ["Medicaid", "Medi-Cal", "SNAP", "CalFresh", "WIC"]
    output_upper = workflow_output.upper()
    return [program for program in known if program.upper() in output_upper]


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
    normalized = field_name.strip().lower()
    return any(marker in normalized for marker in _SENSITIVE_FIELD_MARKERS)


def _plan_item_is_sensitive(item: dict[str, Any]) -> bool:
    if bool(item.get("sensitive")):
        return True

    semantic_text = " ".join(
        str(item.get(key) or "")
        for key in ("profile_key", "question", "label", "description")
    ).lower()
    if any(marker in semantic_text for marker in _SENSITIVE_FIELD_MARKERS):
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


def generate_application_pdf(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path:
    """Download, inspect, validate, and prefill the official Medi-Cal PDF."""
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
