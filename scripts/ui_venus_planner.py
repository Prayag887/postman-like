#!/usr/bin/env python3
"""Cached screen-level planning with UI-Venus on Apple Silicon."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from local_model_scan import (
    CALENDAR_MODE_LABEL,
    CALENDAR_YEAR_LABEL,
    FULL_DATE_LABEL,
    Action,
    infer_contextual_action_variants,
)

MODEL_ID = "mlx-community/UI-Venus-1.5-2B-6bit"
ESCAPE_LABELS = {
    "back",
    "cancel",
    "close",
    "close sheet",
    "dismiss",
    "navigate up",
    "ok",
}


def extract_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("UI-Venus returned no JSON object")
    value = json.loads(match.group())
    if not isinstance(value, dict):
        raise ValueError("UI-Venus response was not an object")
    return value


def representative_actions(actions: list[Action]) -> list[Action]:
    variants = {
        int(value["action_index"]): value
        for value in infer_contextual_action_variants(actions)
    }
    seen: set[tuple[str, str, str]] = set()
    result: list[Action] = []
    for action in actions:
        if (
            action.risk != "safe"
            or action.selected
            or action.label == "Unlabelled control"
        ):
            continue
        variant = variants.get(action.index)
        label_role = action.label.casefold()
        if FULL_DATE_LABEL.fullmatch(action.label):
            label_role = "<date>"
        elif CALENDAR_YEAR_LABEL.fullmatch(action.label):
            label_role = "<year>"
        elif CALENDAR_MODE_LABEL.fullmatch(action.label):
            label_role = "<calendar-mode>"
        key = (
            str(variant.get("collection", "")) if variant else "",
            str(variant.get("variant", "")) if variant else "",
            f"{action.class_name}|{label_role}",
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(action)
    return result


def should_use_ai(actions: list[Action]) -> bool:
    candidates = representative_actions(actions)
    meaningful = [
        action
        for action in candidates
        if action.label.casefold() not in ESCAPE_LABELS
        and not action.label.casefold().startswith("close ")
    ]
    broad = re.compile(
        r"\b(home|study|class|exam|assignment|practice|course|see all|"
        r"details|topic|profile|search|filter)\b",
        re.IGNORECASE,
    )
    return len(meaningful) >= 3 or sum(
        bool(broad.search(action.label)) for action in meaningful
    ) >= 2


class UiVenusPlanner:
    def __init__(self, cache_path: Path | None, enabled: bool = True) -> None:
        self.enabled = enabled
        self.cache_path = cache_path
        self.cache: dict[str, dict[str, Any]] = {}
        self.model: Any = None
        self.processor: Any = None
        self.config: Any = None
        self.unavailable_reason: str | None = None
        if cache_path and cache_path.is_file():
            try:
                value = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(value, dict):
                    self.cache = value
            except (OSError, json.JSONDecodeError):
                self.cache = {}

    def _save(self) -> None:
        if not self.cache_path:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self.cache, indent=2), encoding="utf-8"
        )

    def _load(self) -> None:
        if self.model is not None or self.unavailable_reason:
            return
        try:
            from mlx_vlm import generate, load
            from mlx_vlm.prompt_utils import apply_chat_template
            from mlx_vlm.utils import load_config

            self.generate = generate
            self.apply_chat_template = apply_chat_template
            self.model, self.processor = load(MODEL_ID)
            self.config = load_config(MODEL_ID)
        except Exception as error:
            self.unavailable_reason = f"{type(error).__name__}: {error}"

    def plan(
        self,
        schema_key: str,
        screenshot: Path,
        actions: list[Action],
        tested_intents: set[str],
    ) -> dict[str, Any]:
        eligible = representative_actions(actions)
        labels = {action.label for action in eligible}
        if not should_use_ai(actions):
            return {
                "engine": "component_planner",
                "available": True,
                "cached": True,
                "preferred_action_label": None,
                "reason": "The screen has no ambiguous multi-action choice.",
                "latency_ms": 0,
            }
        cached = self.cache.get(schema_key)
        if cached and cached.get("preferred_action_label") in labels:
            return {**cached, "cached": True, "latency_ms": 0}
        if not self.enabled:
            return {
                "engine": "deterministic_fallback",
                "available": False,
                "reason": "UI-Venus planning was disabled.",
            }
        self._load()
        if self.unavailable_reason:
            return {
                "engine": "deterministic_fallback",
                "available": False,
                "reason": self.unavailable_reason,
            }
        non_escape = [
            action
            for action in eligible
            if action.label.casefold() not in ESCAPE_LABELS
            and not action.label.casefold().startswith("close ")
        ]
        if non_escape:
            eligible = non_escape
        candidates = [
            {
                "action_index": action.index,
                "label": action.label,
                "role": action.class_name,
                "context": action.context[:120],
            }
            for action in eligible[:24]
        ]
        if not candidates:
            return {
                "engine": MODEL_ID,
                "available": True,
                "preferred_action_label": None,
                "reason": "No safe candidate action exists.",
            }
        prompt = (
            "Choose exactly one candidate that maximizes meaningful new feature "
            "coverage. Respond with one minified JSON object containing only "
            '"action_index" and "reason". Fill both with an actual candidate index '
            "and a concrete reason based on the screenshot. Do not echo a schema "
            "or use placeholder text. Understand the screen as components, not "
            "individual nodes. "
            "Avoid login, purchase, submit, destructive actions, selected tabs, "
            "equivalent dates, equivalent years, repeated cards, and previously "
            f"tested intents. Tested intents: {json.dumps(sorted(tested_intents)[-30:])}. "
            f"Candidates: {json.dumps(candidates, separators=(',', ':'))}"
        )
        started = time.monotonic()
        try:
            formatted = self.apply_chat_template(
                self.processor, self.config, prompt, num_images=1
            )
            result = self.generate(
                self.model,
                self.processor,
                formatted,
                [str(screenshot)],
                max_tokens=96,
                temp=0.0,
                verbose=False,
            )
            parsed = extract_json(result.text)
            chosen_index = int(parsed.get("action_index", -1))
            reason = str(parsed.get("reason", "")).strip()
            if not reason or reason in {"...", "reason"}:
                raise ValueError("UI-Venus returned a placeholder reason")
            chosen = next(
                (
                    action
                    for action in eligible
                    if action.index == chosen_index
                ),
                None,
            )
            if chosen is None:
                raise ValueError(
                    "UI-Venus selected an index outside the candidate set"
                )
            decision = {
                "engine": MODEL_ID,
                "available": True,
                "cached": False,
                "preferred_action_index": chosen.index,
                "preferred_action_label": chosen.label,
                "reason": reason[:500],
                "latency_ms": round((time.monotonic() - started) * 1000),
            }
            self.cache[schema_key] = decision
            self._save()
            return decision
        except Exception as error:
            return {
                "engine": MODEL_ID,
                "available": True,
                "cached": False,
                "preferred_action_label": None,
                "reason": f"{type(error).__name__}: {error}",
                "latency_ms": round((time.monotonic() - started) * 1000),
            }


def preferred_action_index(
    actions: list[Action], decision: dict[str, Any]
) -> int:
    try:
        chosen_index = int(decision.get("preferred_action_index", -1))
    except (TypeError, ValueError):
        chosen_index = -1
    if 0 <= chosen_index < len(actions):
        action = actions[chosen_index]
        if action.risk == "safe" and not action.selected:
            return action.index
    label = decision.get("preferred_action_label")
    matches = [
        action
        for action in actions
        if action.label == label and action.risk == "safe" and not action.selected
    ]
    return matches[0].index if len(matches) == 1 else -1
