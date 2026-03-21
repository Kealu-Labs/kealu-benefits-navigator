"""Step definitions for marketplace_api_integration.feature.

These tests hit the live CMS Marketplace API and require CMS_API_KEY to be set.
They are marked @integration and skipped by default — run with:

    pytest -m integration

"""

from __future__ import annotations

import os

import pytest
from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.marketplace_api import (
    estimate_eligibility,
    resolve_county,
    search_plans,
)

# Skip all tests in this module if CMS_API_KEY is not set
pytestmark = pytest.mark.integration


def _skip_if_no_key():
    if not os.environ.get("CMS_API_KEY"):
        pytest.skip("CMS_API_KEY not set — skipping live API test")


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario(
    "../features/marketplace_api_integration.feature",
    "Live ZIP code resolves to county",
)
def test_live_zip_resolves():
    pass


@scenario(
    "../features/marketplace_api_integration.feature",
    "Live eligibility estimate returns APTC fields",
)
def test_live_eligibility():
    pass


@scenario(
    "../features/marketplace_api_integration.feature",
    "Live plan search returns real plans",
)
def test_live_plan_search():
    pass


# ---------------------------------------------------------------------------
# Shared context
# ---------------------------------------------------------------------------


class LiveContext:
    def __init__(self):
        self.county_result: dict = {}
        self.eligibility_result: dict = {}
        self.plan_result: dict = {}
        self.fips: str = ""
        self.state: str = ""


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when(parsers.parse('the live API resolves ZIP "{zip_code}"'), target_fixture="ctx")
def live_resolve_zip(zip_code):
    _skip_if_no_key()
    ctx = LiveContext()
    ctx.county_result = resolve_county(zip_code)
    return ctx


@given(parsers.parse('live county FIPS for ZIP "{zip_code}"'), target_fixture="ctx")
def live_county_fips(zip_code):
    _skip_if_no_key()
    ctx = LiveContext()
    result = resolve_county(zip_code)
    counties = result.get("counties", [])
    assert counties, f"No counties returned for ZIP {zip_code}"
    ctx.fips = counties[0]["fips"]
    ctx.state = counties[0]["state"]
    return ctx


@when(parsers.parse("live eligibility is estimated for income {income:d} with {n:d} people"))
def live_estimate(ctx, income, n):
    people = [{"age": 35, "gender": "Female", "uses_tobacco": False, "is_pregnant": False}]
    for _ in range(n - 1):
        people.append({"age": 8, "gender": "Male", "uses_tobacco": False, "is_pregnant": False})
    ctx.eligibility_result = estimate_eligibility(
        income, people, ctx.state, ctx.fips, "77001"
    )


@when(parsers.parse("live plans are searched with income {income:d}"))
def live_search(ctx, income):
    people = [{"age": 35, "gender": "Female", "uses_tobacco": False}]
    people.append({"age": 4, "gender": "Male", "uses_tobacco": False})
    people.append({"age": 9, "gender": "Female", "uses_tobacco": False})
    ctx.plan_result = search_plans(
        income, people, ctx.fips, ctx.state, "77001", limit=5
    )


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse("the live county result has at least {n:d} county"))
def check_live_county_count(ctx, n):
    counties = ctx.county_result.get("counties", [])
    assert len(counties) >= n, f"Expected at least {n} counties, got {len(counties)}"


@then("the live county has a FIPS code and state")
def check_live_county_fields(ctx):
    county = ctx.county_result["counties"][0]
    assert county.get("fips"), f"Missing FIPS: {county}"
    assert county.get("state"), f"Missing state: {county}"


@then('the live result contains "aptc" and "csr" fields')
def check_live_aptc_fields(ctx):
    estimates = ctx.eligibility_result.get("estimates", [])
    assert estimates, f"No estimates returned: {ctx.eligibility_result}"
    est = estimates[0]
    assert "aptc" in est, f"Missing 'aptc' in estimate: {est}"
    assert "csr" in est, f"Missing 'csr' in estimate: {est}"


@then("the live APTC is greater than 0")
def check_live_aptc_positive(ctx):
    estimates = ctx.eligibility_result.get("estimates", [])
    assert estimates, "No estimates returned"
    aptc = estimates[0].get("aptc", 0)
    assert aptc > 0, f"APTC was {aptc}, expected > 0"


@then(parsers.parse("at least {n:d} live plan is returned"))
def check_live_plan_count(ctx, n):
    plans = ctx.plan_result.get("plans", [])
    assert len(plans) >= n, f"Expected at least {n} plans, got {len(plans)}"


@then("each live plan has name, issuer, metal_level, premium, and premium_w_credit")
def check_live_plan_fields(ctx):
    for plan in ctx.plan_result.get("plans", []):
        assert plan.get("name"), f"Plan missing name: {plan.get('id')}"
        assert plan.get("issuer", {}).get("name"), f"Plan missing issuer: {plan.get('id')}"
        assert plan.get("metal_level"), f"Plan missing metal_level: {plan.get('id')}"
        assert "premium" in plan, f"Plan missing premium: {plan.get('id')}"
        assert "premium_w_credit" in plan, f"Plan missing premium_w_credit: {plan.get('id')}"
