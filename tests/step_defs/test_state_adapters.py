#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Step definitions for state_adapters.feature.

Tests cover:
- State registry lookup (CA registered, TX not registered, case-insensitive)
- Fake adapter registration and invocation
- Readiness determinism
- MCP flow through the adapter (review gate, PDF generation, fallback)
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pytest_bdd import given, parsers, scenario, then, when

import benefits_navigator.states  # noqa: F401 — ensures CA is registered
from benefits_navigator.applications.models import ApplicationProfile
from benefits_navigator.applications.registry import get as registry_get
from benefits_navigator.applications.registry import register, unregister
from benefits_navigator.mcp_server import _execute_tool

# ---------------------------------------------------------------------------
# Scenario bindings
# ---------------------------------------------------------------------------


@scenario("../features/state_adapters.feature", "California adapter is registered in the state registry")
def test_ca_registered():
    pass


@scenario("../features/state_adapters.feature", "Unsupported state returns None from the registry")
def test_tx_not_registered():
    pass


@scenario("../features/state_adapters.feature", "State code lookup is case-insensitive")
def test_case_insensitive():
    pass


@scenario("../features/state_adapters.feature", "A fake adapter can be registered and invoked through the registry")
def test_fake_adapter():
    pass


@scenario("../features/state_adapters.feature", "Readiness check is deterministic for the same profile")
def test_readiness_deterministic():
    pass


@scenario("../features/state_adapters.feature", "Readiness check blocks when ZIP is missing")
def test_readiness_blocks_missing_zip():
    pass


@scenario("../features/state_adapters.feature", "MCP generate_application_draft requires review confirmation before PDF")
def test_mcp_review_gate():
    pass


@scenario("../features/state_adapters.feature", "MCP generate_application_draft generates PDF after confirmation")
def test_mcp_pdf_generation():
    pass


@scenario("../features/state_adapters.feature", "Unsupported state bypasses adapter and uses fallback path")
def test_unsupported_state_fallback():
    pass


# ---------------------------------------------------------------------------
# Shared context
# ---------------------------------------------------------------------------


class AdapterCtx:
    def __init__(self):
        self.state_code: str = ""
        self.adapter: Any = None
        self.profile: ApplicationProfile | None = None
        self.blockers_1: list[dict] = []
        self.blockers_2: list[dict] = []
        self.tool_result: str = ""
        self.fake_called: bool = False
        self.output_dir: Path = Path(tempfile.mkdtemp())


# ---------------------------------------------------------------------------
# Given steps — registry
# ---------------------------------------------------------------------------


@given("the state registry is initialized", target_fixture="ctx")
def given_registry_initialized():
    return AdapterCtx()


@given(parsers.parse('a California profile with ZIP "{zip_code}" and state "{state}"'), target_fixture="ctx")
def given_ca_profile(zip_code, state):
    ctx = AdapterCtx()
    ctx.profile = ApplicationProfile(home_zip=zip_code, home_state=state)
    return ctx


@given("a California profile with no ZIP and state \"CA\"", target_fixture="ctx")
def given_ca_profile_no_zip():
    ctx = AdapterCtx()
    ctx.profile = ApplicationProfile(home_zip="", home_state="CA")
    return ctx


@given("a fake adapter is registered for state \"ZZ\"", target_fixture="ctx")
def given_fake_adapter():
    ctx = AdapterCtx()

    class FakeAdapter:
        state_code = "ZZ"
        display_name = "Fake ZZ Application"
        supported_programs = ["FakeProgram"]

        def missing_intake_questions(self, profile):
            return []

        def readiness_blockers(self, profile):
            return []

        def review_summary(self, profile):
            return "## Review\nLooks good.\nReply confirm."

        def applicable_forms(self, profile):
            return []

        def generate_documents(self, profile, workflow_output, output_dir):
            ctx.fake_called = True
            fake_path = Path(tempfile.mkdtemp()) / "fake.pdf"
            fake_path.write_bytes(b"%PDF-1.4 fake")
            return fake_path, "official"

        def submission_instructions(self, profile):
            return "Submit to ZZ office."

    register(FakeAdapter())
    return ctx


_CA_WORKFLOW = (
    "## Eligibility Results\n"
    "- CalFresh: LIKELY ELIGIBLE\n"
    "- Medi-Cal: ELIGIBLE\n"
)

_CA_ALL_FIELDS = {
    "household_profile": "Single parent, 2 kids, $42k income",
    "state": "CA",
    "zip_code": "90001",
    "county": "Los Angeles County",
    "workflow_output": _CA_WORKFLOW,
    "applicant_name": "Jane Marie Smith",
    "phone_home": "(555) 123-4567",
    "home_address": "123 Main Street, Apt 4B",
    "home_city": "Los Angeles",
    "email": "jane@example.com",
    "language_speak": "English",
}


@given("a CA generate_application_draft request with all personal details but no confirmation", target_fixture="ctx")
def given_ca_no_confirm(tmp_path):
    ctx = AdapterCtx()
    ctx.output_dir = tmp_path
    ctx.tool_args = {**_CA_ALL_FIELDS}
    return ctx


@given("a CA generate_application_draft request with all personal details confirmed", target_fixture="ctx")
def given_ca_confirmed(tmp_path):
    ctx = AdapterCtx()
    ctx.output_dir = tmp_path
    ctx.tool_args = {**_CA_ALL_FIELDS, "ca_review_confirmed": True}
    return ctx


@given("a Texas generate_application_draft request", target_fixture="ctx")
def given_texas(tmp_path):
    ctx = AdapterCtx()
    ctx.output_dir = tmp_path
    ctx.tool_args = {
        "household_profile": "Single parent, 2 kids, $42k income",
        "state": "TX",
        "zip_code": "77001",
        "county": "Harris County",
        "workflow_output": "## Results\n- SNAP: LIKELY ELIGIBLE\n",
    }
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when(parsers.parse('I look up state "{code}" in the registry'))
def when_lookup(ctx, code):
    ctx.state_code = code
    ctx.adapter = registry_get(code)


@when("I call generate_documents on the fake adapter via the registry")
def when_fake_generate(ctx):
    adapter = registry_get("ZZ")
    assert adapter is not None, "Fake adapter not found in registry"
    profile = ApplicationProfile(home_zip="00000", home_state="ZZ", review_confirmed=True)
    ctx.tool_result_path, _ = adapter.generate_documents(profile, "workflow out", None)


@when("readiness_blockers is called twice on the same profile")
def when_readiness_twice(ctx):
    adapter = registry_get("CA")
    assert adapter is not None
    ctx.blockers_1 = adapter.readiness_blockers(ctx.profile)
    ctx.blockers_2 = adapter.readiness_blockers(ctx.profile)


@when("readiness_blockers is called on the profile")
def when_readiness_once(ctx):
    adapter = registry_get("CA")
    assert adapter is not None
    ctx.blockers_1 = adapter.readiness_blockers(ctx.profile)


@when("generate_application_draft is executed via the MCP layer")
def when_mcp_execute(ctx):
    ctx.tool_result = _execute_tool("generate_application_draft", ctx.tool_args)


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then("a non-None adapter is returned")
def then_adapter_found(ctx):
    assert ctx.adapter is not None, f"Expected adapter for '{ctx.state_code}', got None"


@then(parsers.parse('the adapter supports programs "{p1}", "{p2}", and "{p3}"'))
def then_adapter_programs(ctx, p1, p2, p3):
    programs = ctx.adapter.supported_programs
    for p in (p1, p2, p3):
        assert p in programs, f"Expected '{p}' in supported_programs, got {programs}"


@then("the registry returns None")
def then_adapter_none(ctx):
    assert ctx.adapter is None, f"Expected None for '{ctx.state_code}', got {ctx.adapter}"


@then("the fake adapter's generate_documents method is called")
def then_fake_called(ctx):
    assert ctx.fake_called, "Expected FakeAdapter.generate_documents to be called"


@then("the registry is cleaned up after the test")
def then_cleanup(ctx):
    unregister("ZZ")
    assert registry_get("ZZ") is None


@then("both results are identical and empty")
def then_deterministic(ctx):
    assert ctx.blockers_1 == ctx.blockers_2, (
        f"Readiness is non-deterministic: {ctx.blockers_1} != {ctx.blockers_2}"
    )
    assert ctx.blockers_1 == [], f"Expected no blockers for valid CA profile, got {ctx.blockers_1}"


@then(parsers.parse('the blockers list contains a "{key}" entry'))
def then_blockers_has(ctx, key):
    keys = [b["key"] for b in ctx.blockers_1]
    assert key in keys, f"Expected '{key}' in blockers, got keys: {keys}"


@then("the result shows the review confirmation screen")
def then_review_screen(ctx):
    assert "Review Your California SAWS-1 Application" in ctx.tool_result, (
        f"Expected review header in result:\n{ctx.tool_result}"
    )
    assert "confirm" in ctx.tool_result.lower(), (
        f"Expected 'confirm' in review screen:\n{ctx.tool_result}"
    )


@then("the result contains the SAWS-1 file path")
def then_saws1_path(ctx):
    assert "SAWS-1" in ctx.tool_result, f"Expected 'SAWS-1' in result:\n{ctx.tool_result}"
    assert ".pdf" in ctx.tool_result, f"Expected .pdf in result:\n{ctx.tool_result}"


@then("the result contains California submission instructions")
def then_ca_instructions(ctx):
    assert "How to Submit" in ctx.tool_result, (
        f"Expected submission instructions:\n{ctx.tool_result}"
    )
    assert "benefitscal.com" in ctx.tool_result or "cdss.ca.gov" in ctx.tool_result, (
        f"Expected CA portal links:\n{ctx.tool_result}"
    )


@then("the result contains a PDF file path")
def then_pdf_path(ctx):
    assert ".pdf" in ctx.tool_result, f"Expected .pdf in result:\n{ctx.tool_result}"


@then("the result does not mention SAWS-1 submission instructions")
def then_no_saws1_instructions(ctx):
    assert "How to Submit Your SAWS-1" not in ctx.tool_result, (
        f"Unexpected SAWS-1 instructions in non-CA result:\n{ctx.tool_result[:500]}"
    )
