"""Healthcare.gov Marketplace API client.

Thin wrapper around the CMS Marketplace API for real insurance plan data.
Uses only the Python standard library (urllib) — zero external dependencies.

API docs: https://developer.cms.gov/marketplace-api/
"""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL = "https://marketplace.api.healthcare.gov/api/v1"
_TIMEOUT = int(os.environ.get("CMS_API_TIMEOUT", "15"))
_MAX_RETRIES = 3
_RETRY_BACKOFF = (1, 2, 4)  # seconds

# Module-level opener for HTTP keep-alive connection reuse
_opener = urllib.request.build_opener()


class MissingAPIKeyError(Exception):
    """Raised when CMS_API_KEY is not configured."""


def _api_key() -> str:
    key = os.environ.get("CMS_API_KEY", "")
    if not key:
        raise MissingAPIKeyError(
            "CMS_API_KEY environment variable is not set.\n"
            "Request a free key at: https://developer.cms.gov/marketplace-api/key-request.html"
        )
    return key


def _request_with_retry(req: urllib.request.Request) -> Any:
    """Execute an HTTP request with retry and exponential backoff for transient errors."""
    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            with _opener.open(req, timeout=_TIMEOUT) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                raise
            last_exc = exc
        except (urllib.error.URLError, OSError) as exc:
            last_exc = exc
        if attempt < _MAX_RETRIES - 1:
            delay = _RETRY_BACKOFF[attempt]
            logger.warning(
                "API request failed (attempt %d/%d), retrying in %ds: %s",
                attempt + 1,
                _MAX_RETRIES,
                delay,
                last_exc,
            )
            time.sleep(delay)
    raise last_exc  # type: ignore[misc]


def _get(path: str, params: dict[str, str] | None = None) -> Any:
    """HTTP GET against the Marketplace API."""
    query = dict(params) if params else {}
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(query)}" if query else f"{BASE_URL}{path}"
    logger.info("GET %s", url)
    req = urllib.request.Request(url, headers={"Accept": "application/json", "apikey": _api_key()})
    return _request_with_retry(req)


def _post(path: str, body: dict[str, Any], params: dict[str, str] | None = None) -> Any:
    """HTTP POST against the Marketplace API."""
    query = dict(params) if params else {}
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(query)}" if query else f"{BASE_URL}{path}"
    logger.info("POST %s", url)
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json", "apikey": _api_key()},
        method="POST",
    )
    return _request_with_retry(req)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_county(zip_code: str) -> dict[str, Any]:
    """Resolve a ZIP code to county FIPS code(s).

    Returns: {"counties": [{"fips": "...", "name": "...", "state": "...", ...}]}
    Raises ValueError if zip_code is not a valid 5-digit US ZIP.
    """
    if not re.fullmatch(r"\d{5}", zip_code):
        raise ValueError(f"Invalid ZIP code format: {zip_code!r} (expected 5 digits)")
    return _resolve_county_cached(zip_code)


@functools.lru_cache(maxsize=256)
def _resolve_county_cached(zip_code: str) -> dict[str, Any]:
    """Cached ZIP-to-county lookup (static geographic data)."""
    return _get(f"/counties/by/zip/{zip_code}")


def estimate_eligibility(
    household_income: int,
    people: list[dict[str, Any]],
    state: str,
    county_fips: str,
    zip_code: str,
) -> dict[str, Any]:
    """Estimate APTC, CSR, and Medicaid/CHIP eligibility.

    Each person dict should have: age, gender, is_pregnant (bool), uses_tobacco (bool),
    and optionally relationship (str, e.g. "spouse") for has_married_couple detection.
    Returns eligibility estimates including APTC amount and CSR level.
    """
    household = {
        "income": household_income,
        "people": [
            {
                "age": p.get("age", 30),
                "aptc_eligible": True,
                "gender": p.get("gender", "Female"),
                "uses_tobacco": p.get("uses_tobacco", False),
                "is_pregnant": p.get("is_pregnant", False),
            }
            for p in people
        ],
        "has_married_couple": any(p.get("relationship") == "spouse" for p in people),
    }
    place = {"countyfips": county_fips, "state": state, "zipcode": zip_code}
    return _post("/households/eligibility/estimates", {"household": household, "place": place})


def search_plans(
    household_income: int,
    people: list[dict[str, Any]],
    county_fips: str,
    state: str,
    zip_code: str,
    *,
    year: int = 2025,
    limit: int = 10,
    metal_levels: list[str] | None = None,
) -> dict[str, Any]:
    """Search marketplace plans with household-specific premium calculations.

    Returns plans sorted by premium (lowest first) with APTC applied.
    """
    body: dict[str, Any] = {
        "household": {
            "income": household_income,
            "people": [
                {
                    "age": p.get("age", 30),
                    "aptc_eligible": True,
                    "gender": p.get("gender", "Female"),
                    "uses_tobacco": p.get("uses_tobacco", False),
                }
                for p in people
            ],
        },
        "market": "Individual",
        "place": {
            "countyfips": county_fips,
            "state": state,
            "zipcode": zip_code,
        },
        "year": year,
        "sort": "premium",
        "order": "asc",
        "offset": 0,
        "limit": limit,
    }
    if metal_levels:
        body["filter"] = {"metal_levels": metal_levels}
    return _post("/plans/search", body, params={"year": str(year)})


def check_drug_coverage(plan_ids: list[str], drug_rxcui: str) -> dict[str, Any]:
    """Check if a drug (by RxCUI) is covered under specific plans."""
    params = {
        "drugs": drug_rxcui,
        "planids": ",".join(plan_ids),
    }
    return _get("/drugs/covered", params)


def check_provider_coverage(plan_ids: list[str], npi: str) -> dict[str, Any]:
    """Check if a provider (by NPI) is in-network for specific plans."""
    params = {
        "providerid": npi,
        "planids": ",".join(plan_ids),
    }
    return _get("/providers/covered", params)


def get_state_medicaid(state_abbrev: str) -> dict[str, Any]:
    """Get Medicaid poverty level thresholds for a state (cached)."""
    return _get_state_medicaid_cached(state_abbrev)


@functools.lru_cache(maxsize=64)
def _get_state_medicaid_cached(state_abbrev: str) -> dict[str, Any]:
    """Cached state Medicaid threshold lookup."""
    return _get(f"/states/{state_abbrev}/medicaid")


# ---------------------------------------------------------------------------
# High-level helpers
# ---------------------------------------------------------------------------


def format_plans_summary(search_result: dict[str, Any], eligibility: dict[str, Any] | None = None) -> str:
    """Format plan search results into a readable markdown summary."""
    plans = search_result.get("plans", [])
    total = search_result.get("total", 0)
    ranges = search_result.get("ranges", {})

    lines = [f"## Healthcare.gov Marketplace Plans ({total} plans available)\n"]

    if eligibility:
        estimates = eligibility.get("estimates", [{}])
        if estimates:
            est = estimates[0]
            aptc = est.get("aptc", 0)
            csr = est.get("csr", "none")
            lines.append(f"**Estimated monthly tax credit (APTC):** ${aptc:.2f}")
            if csr and csr != "none":
                lines.append(f"**Cost-sharing reduction level:** {csr}")
            is_medicaid = est.get("is_medicaid_chip", False)
            if is_medicaid:
                lines.append("**Note:** This household may qualify for Medicaid/CHIP — check with your state.")
            lines.append("")

    if ranges:
        prem = ranges.get("premiums", {})
        ded = ranges.get("deductibles", {})
        if prem:
            lines.append(
                f"**Premium range:** ${prem.get('min', 0):.2f} – ${prem.get('max', 0):.2f}/month "
                f"(after tax credits)"
            )
        if ded:
            lines.append(
                f"**Deductible range:** ${ded.get('min', 0):,.0f} – ${ded.get('max', 0):,.0f}"
            )
        lines.append("")

    # Top plans by metal level
    for plan in plans[:limit_plans(plans)]:
        name = plan.get("name", "Unknown Plan")
        issuer = plan.get("issuer", {}).get("name", "")
        metal = plan.get("metal_level", "").title()
        premium = plan.get("premium", 0)
        premium_w_credit = plan.get("premium_w_credit", premium)
        deductible = plan.get("deductibles", [{}])[0].get("amount", "N/A") if plan.get("deductibles") else "N/A"
        moops = plan.get("moops", [{}])[0].get("amount", "N/A") if plan.get("moops") else "N/A"
        quality = plan.get("quality_rating", {}).get("global_rating", "N/A")
        plan_type = plan.get("type", "").upper()

        lines.append(f"### {name}")
        lines.append(f"- **Issuer:** {issuer}")
        lines.append(f"- **Metal level:** {metal} | **Type:** {plan_type}")
        lines.append(f"- **Monthly premium:** ${premium:.2f} → **${premium_w_credit:.2f}/mo after tax credit**")
        lines.append(f"- **Annual deductible:** ${deductible}")
        lines.append(f"- **Out-of-pocket max:** ${moops}")
        if quality != "N/A":
            lines.append(f"- **Quality rating:** {quality}/5 stars")
        lines.append("")

    shown = limit_plans(plans)
    if total > shown:
        lines.append(f"*Showing top {shown} of {total} available plans.*\n")

    return "\n".join(lines)


def limit_plans(plans: list) -> int:
    """Return how many plans to show — up to 5."""
    return min(len(plans), 5)
