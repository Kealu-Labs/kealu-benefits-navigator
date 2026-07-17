#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""California state adapter — registers CaliforniaAdapter on import."""
from benefits_navigator.states.california.adapter import CaliforniaAdapter
from benefits_navigator.applications.registry import register as _register

_register(CaliforniaAdapter())
