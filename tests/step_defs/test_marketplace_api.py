"""Step definitions for marketplace_api.feature."""

from __future__ import annotations

import json
import re
from typing import Any
from unittest.mock import MagicMock, patch

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.marketplace_api import (
    format_plans_summary,
    limit_plans,
    resolve_county,
    search_plans,
    estimate_eligibility,
)
from benefit_navigator.mcp_server import (
    _execute_tool,
    _parse_household_for_api,
    _parse_income,
)
from ..conftest import DEMO_PROFILE

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/marketplace_api.feature", "ZIP code resolves to county FIPS")
def test_zip_resolves():
    pass


@scenario("../features/marketplace_api.feature", "Invalid ZIP returns empty county list")
def test_invalid_zip():
    pass


@scenario("../features/marketplace_api.feature", "Eligibility estimate returns APTC and FPL")
def test_eligibility_aptc():
    pass


@scenario("../features/marketplace_api.feature", "Low-income household flags Medicaid/CHIP")
def test_medicaid_flag():
    pass


@scenario("../features/marketplace_api.feature", "Plan search returns real marketplace plans")
def test_plan_search():
    pass


@scenario("../features/marketplace_api.feature", "Plan search applies APTC to premiums")
def test_aptc_applied():
    pass


@scenario("../features/marketplace_api.feature", "Plans can be filtered by metal level")
def test_metal_filter():
    pass


@scenario("../features/marketplace_api.feature", "Plan summary includes premium range and APTC")
def test_summary_format():
    pass


@scenario("../features/marketplace_api.feature", "Plan summary shows up to 5 plans")
def test_summary_limit():
    pass


@scenario("../features/marketplace_api.feature", "compare_insurance_plans uses marketplace API when key is set")
def test_compare_with_api():
    pass


@scenario("../features/marketplace_api.feature", "compare_insurance_plans falls back to kvr when no API key")
def test_compare_fallback_no_key():
    pass


@scenario("../features/marketplace_api.feature", "compare_insurance_plans falls back on API error")
def test_compare_fallback_error():
    pass


@scenario("../features/marketplace_api.feature", "check_eligibility enriches with CMS data when key is set")
def test_eligibility_enrichment():
    pass


@scenario("../features/marketplace_api.feature", "Household profile is parsed into API people list")
def test_parse_household():
    pass


@scenario("../features/marketplace_api.feature", "Income is extracted from profile text")
def test_parse_income():
    pass


@scenario("../features/marketplace_api.feature", "Income shorthand is expanded")
def test_income_shorthand():
    pass


# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

MOCK_COUNTY_RESPONSE = {
    "counties": [
        {"fips": "48201", "name": "Harris County", "state": "TX", "rating_area": "12"}
    ]
}

MOCK_ELIGIBILITY_RESPONSE = {
    "estimates": [
        {
            "aptc": 380.42,
            "csr": "CSR-87",
            "is_medicaid_chip": False,
            "fpl": 162.7,
        }
    ]
}

MOCK_ELIGIBILITY_MEDICAID = {
    "estimates": [
        {
            "aptc": 0,
            "csr": "none",
            "is_medicaid_chip": True,
            "fpl": 77.5,
        }
    ]
}


def _make_mock_plan(idx: int, metal: str = "Silver", premium: float = 620.0) -> dict:
    aptc = 380.0
    return {
        "id": f"48201TX000{idx:04d}",
        "name": f"Blue Cross {metal} Plan {idx}",
        "issuer": {"name": "Blue Cross Blue Shield of Texas"},
        "metal_level": metal.lower(),
        "type": "HMO",
        "premium": premium,
        "premium_w_credit": max(0, premium - aptc),
        "deductibles": [{"amount": 750 if metal == "Silver" else 3000, "type": "Medical"}],
        "moops": [{"amount": 4500 if metal == "Silver" else 8000, "type": "Medical"}],
        "quality_rating": {"global_rating": 4},
        "benefits": [],
    }


def _make_plan_search_result(n: int, metal: str | None = None) -> dict:
    plans = [_make_mock_plan(i, metal or ["Bronze", "Silver", "Gold"][i % 3]) for i in range(n)]
    premiums = [p["premium_w_credit"] for p in plans]
    deductibles = [p["deductibles"][0]["amount"] for p in plans]
    return {
        "total": n,
        "plans": plans,
        "ranges": {
            "premiums": {"min": min(premiums), "max": max(premiums)},
            "deductibles": {"min": min(deductibles), "max": max(deductibles)},
        },
    }


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class MarketplaceContext:
    def __init__(self):
        self.county_result: dict = {}
        self.eligibility_result: dict = {}
        self.plan_result: dict = {}
        self.formatted: str = ""
        self.result: str = ""
        self.people: list = []
        self.income: int = 0
        self.kvr_invoked: bool = False


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("the demo household profile", target_fixture="ctx")
def given_demo():
    ctx = MarketplaceContext()
    ctx.args = dict(DEMO_PROFILE)
    return ctx


@given(parsers.parse('county FIPS "{fips}" in state "{state}"'))
def given_county(ctx, fips, state):
    ctx.fips = fips
    ctx.state = state


@given("CMS_API_KEY is set")
def given_api_key_set(ctx, monkeypatch):
    monkeypatch.setenv("CMS_API_KEY", "test-key-for-bdd")


@given("CMS_API_KEY is not set")
def given_api_key_unset(ctx, monkeypatch):
    monkeypatch.delenv("CMS_API_KEY", raising=False)


@given("the marketplace API is unreachable")
def given_api_unreachable(ctx, monkeypatch):
    import urllib.error
    import benefit_navigator.marketplace_api as api_mod

    def _raise(*args, **kwargs):
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr(api_mod, "_get", _raise)
    monkeypatch.setattr(api_mod, "_post", _raise)


@given(parsers.parse("a mock plan search result with {n:d} plans"))
def given_mock_plans(ctx, n):
    ctx.plan_result = _make_plan_search_result(n)


@given(parsers.parse("a mock eligibility result with APTC {aptc:f}"))
def given_mock_eligibility(ctx, aptc):
    ctx.eligibility_result = {"estimates": [{"aptc": aptc, "csr": "CSR-87", "is_medicaid_chip": False}]}


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when(parsers.parse('the marketplace API resolves ZIP "{zip_code}"'))
def resolve_zip(ctx, zip_code, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod

    response = MOCK_COUNTY_RESPONSE if zip_code != "00000" else {"counties": []}
    monkeypatch.setattr(api_mod, "_get", lambda *a, **kw: response)
    ctx.county_result = resolve_county(zip_code)


@when(parsers.parse("eligibility is estimated for income {income:d} with {n:d} people"))
def estimate_elig(ctx, income, n, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod

    response = MOCK_ELIGIBILITY_MEDICAID if income < 25000 else MOCK_ELIGIBILITY_RESPONSE
    monkeypatch.setattr(api_mod, "_post", lambda *a, **kw: response)
    people = [{"age": 30}] + [{"age": 8}] * (n - 1)
    ctx.eligibility_result = estimate_eligibility(income, people, ctx.state, ctx.fips, ctx.args.get("zip_code", "77001"))


@when(parsers.parse('plans are searched for ZIP "{zip_code}" with income {income:d}'))
def search(ctx, zip_code, income, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod

    monkeypatch.setattr(api_mod, "_post", lambda *a, **kw: _make_plan_search_result(5))
    ctx.plan_result = search_plans(income, [{"age": 30}, {"age": 4}, {"age": 9}], ctx.fips, ctx.state, zip_code)


@when(parsers.parse('plans are searched for ZIP "{zip_code}" with income {income:d} filtering "{metal}"'))
def search_filtered(ctx, zip_code, income, metal, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod

    monkeypatch.setattr(api_mod, "_post", lambda *a, **kw: _make_plan_search_result(3, metal))
    ctx.plan_result = search_plans(
        income, [{"age": 30}, {"age": 4}, {"age": 9}], ctx.fips, ctx.state, zip_code, metal_levels=[metal]
    )


@when("the results are formatted")
def format_results(ctx):
    ctx.formatted = format_plans_summary(ctx.plan_result, ctx.eligibility_result or None)


@when(parsers.parse('compare_insurance_plans is called for ZIP "{zip_code}"'))
def compare_with_api(ctx, zip_code, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod

    monkeypatch.setattr(api_mod, "_get", lambda *a, **kw: MOCK_COUNTY_RESPONSE)
    monkeypatch.setattr(api_mod, "_post", lambda path, *a, **kw: (
        MOCK_ELIGIBILITY_RESPONSE if "eligibility" in path else _make_plan_search_result(5)
    ))
    ctx.result = _execute_tool("compare_insurance_plans", {**ctx.args, "zip_code": zip_code})


@when(parsers.parse('compare_insurance_plans is called for ZIP "{zip_code}" with kvr fallback'))
def compare_with_fallback(ctx, zip_code, monkeypatch):
    import subprocess as sp

    def mock_run(cmd, **kwargs):
        ctx.kvr_invoked = True
        result = MagicMock()
        result.stdout = "Mock kvr assist insurance comparison"
        result.stderr = ""
        result.returncode = 0
        return result

    monkeypatch.setattr(sp, "run", mock_run)
    ctx.result = _execute_tool("compare_insurance_plans", {**ctx.args, "zip_code": zip_code})


@when(parsers.parse('check_eligibility is called for "{program}" with kvr fallback'))
def check_elig_with_enrichment(ctx, program, monkeypatch):
    import benefit_navigator.marketplace_api as api_mod
    import subprocess as sp

    monkeypatch.setattr(api_mod, "_get", lambda *a, **kw: MOCK_COUNTY_RESPONSE)
    monkeypatch.setattr(api_mod, "_post", lambda *a, **kw: MOCK_ELIGIBILITY_RESPONSE)

    def mock_run(cmd, **kwargs):
        result = MagicMock()
        result.stdout = "Mock kvr assist eligibility output"
        result.stderr = ""
        result.returncode = 0
        return result

    monkeypatch.setattr(sp, "run", mock_run)
    ctx.result = _execute_tool("check_eligibility", {**ctx.args, "program": program})


@when(parsers.parse('the profile "{profile}" is parsed'))
def parse_household(ctx, profile):
    ctx.people = _parse_household_for_api({"household_profile": profile})


@when(parsers.parse('income is parsed from "{profile}"'))
def parse_income(ctx, profile):
    ctx.income = _parse_income({"household_profile": profile})


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('the county FIPS is "{fips}"'))
def check_fips(ctx, fips):
    counties = ctx.county_result.get("counties", [])
    assert counties and counties[0]["fips"] == fips


@then(parsers.parse('the county state is "{state}"'))
def check_state(ctx, state):
    counties = ctx.county_result.get("counties", [])
    assert counties and counties[0]["state"] == state


@then("the county list is empty")
def check_empty_counties(ctx):
    assert ctx.county_result.get("counties", []) == []


@then("the APTC is greater than 0")
def check_aptc_positive(ctx):
    est = ctx.eligibility_result.get("estimates", [{}])[0]
    assert est.get("aptc", 0) > 0, f"APTC was {est.get('aptc')}"


@then(parsers.parse("the FPL percentage is approximately {fpl:d}"))
def check_fpl(ctx, fpl):
    est = ctx.eligibility_result.get("estimates", [{}])[0]
    actual = est.get("fpl", 0)
    assert abs(actual - fpl) < 5, f"Expected FPL ~{fpl}, got {actual}"


@then("the result flags Medicaid/CHIP eligibility")
def check_medicaid_flag(ctx):
    est = ctx.eligibility_result.get("estimates", [{}])[0]
    assert est.get("is_medicaid_chip") is True


@then(parsers.parse("at least {n:d} plan is returned"))
def check_plan_count(ctx, n):
    plans = ctx.plan_result.get("plans", [])
    assert len(plans) >= n, f"Expected at least {n} plans, got {len(plans)}"


@then("each plan has a name, metal level, and premium")
def check_plan_fields(ctx):
    for plan in ctx.plan_result.get("plans", []):
        assert plan.get("name"), f"Plan missing name: {plan}"
        assert plan.get("metal_level"), f"Plan missing metal_level: {plan}"
        assert "premium" in plan, f"Plan missing premium: {plan}"


@then("each plan has premium_w_credit less than or equal to premium")
def check_aptc_applied(ctx):
    for plan in ctx.plan_result.get("plans", []):
        assert plan["premium_w_credit"] <= plan["premium"], (
            f"premium_w_credit ({plan['premium_w_credit']}) > premium ({plan['premium']})"
        )


@then(parsers.parse('all returned plans have metal level "{metal}"'))
def check_metal_level(ctx, metal):
    for plan in ctx.plan_result.get("plans", []):
        assert plan["metal_level"].lower() == metal.lower(), (
            f"Expected {metal}, got {plan['metal_level']}"
        )


@then(parsers.parse('the summary includes "{text}"'))
def check_summary_includes(ctx, text):
    content = ctx.formatted or ctx.result
    assert text in content, f"Expected '{text}' in:\n{content[:500]}"


@then(parsers.parse("the summary shows at most {n:d} plan details"))
def check_plan_detail_limit(ctx, n):
    # Count ### headings (each plan is a ### section)
    headings = re.findall(r"^### ", ctx.formatted, re.MULTILINE)
    assert len(headings) <= n, f"Found {len(headings)} plan details, expected at most {n}"


@then(parsers.parse('the summary mentions "{text}" total plans'))
def check_total_mention(ctx, text):
    assert text in ctx.formatted, f"Expected '{text}' in formatted output"


@then(parsers.parse('the result includes "{text}"'))
def check_result_includes(ctx, text):
    assert text in ctx.result, f"Expected '{text}' in:\n{ctx.result[:500]}"


@then("the result includes real plan names")
def check_real_plan_names(ctx):
    assert "Blue Cross" in ctx.result, f"Expected real plan name in:\n{ctx.result[:500]}"


@then("kvr assist was invoked")
def check_kvr_invoked(ctx):
    assert ctx.kvr_invoked, "Expected kvr assist to be invoked"


@then(parsers.parse("{n:d} people are extracted"))
def check_people_count(ctx, n):
    assert len(ctx.people) == n, f"Expected {n} people, got {len(ctx.people)}"


@then(parsers.parse("the ages include {a:d} and {b:d}"))
def check_ages(ctx, a, b):
    ages = [p["age"] for p in ctx.people]
    assert a in ages, f"Age {a} not found in {ages}"
    assert b in ages, f"Age {b} not found in {ages}"


@then(parsers.parse("the parsed income is {expected:d}"))
def check_income(ctx, expected):
    assert ctx.income == expected, f"Expected {expected}, got {ctx.income}"
