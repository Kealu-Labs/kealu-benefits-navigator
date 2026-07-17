#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""State adapter registry — keyed by normalized two-letter state code."""

from __future__ import annotations

from benefits_navigator.applications.adapter import StateApplicationAdapter

_registry: dict[str, StateApplicationAdapter] = {}


def register(adapter: StateApplicationAdapter) -> None:
    """Register a state adapter. Overwrites any existing adapter for that state."""
    _registry[adapter.state_code.upper()] = adapter


def get(state_code: str) -> StateApplicationAdapter | None:
    """Return the registered adapter for *state_code*, or None if unsupported."""
    return _registry.get(state_code.upper())


def registered_states() -> list[str]:
    """Return all registered state codes in sorted order."""
    return sorted(_registry.keys())


def unregister(state_code: str) -> None:
    """Remove the adapter for *state_code*. No-op if not registered."""
    _registry.pop(state_code.upper(), None)
