#!/usr/bin/env python3
"""Persistent, safety-first Android graph exploration using a local model."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from local_model_scan import (
    Action,
    FULL_DATE_LABEL,
    capture,
    discover_actions,
    fast_understand_screen,
    fingerprint,
    save_observation,
)
from runtime_diagnostics import LogcatCollector


@dataclass
class StateRecord:
    id: str
    ordinal: int
    path: list[dict[str, Any]]
    hierarchy: str
    screenshot: str
    actions_found: int
    scrollables: int
    screen_name: str
    purpose: str
    flow_stage: str
    semantic_confidence: int
    semantic_evidence: list[str]
    semantic_action_variants: list[dict[str, Any]]
    semantic_preferred_action_index: int


@dataclass
class FrontierItem:
    source_id: str
    path: list[dict[str, Any]]
    action: dict[str, Any]
    semantic_key: str | None = None
    restore_attempts: int = 0


@dataclass
class SamplingGroup:
    key: str
    screen_name: str
    variant: str
    representative: str
    skipped: list[str]


RISKY_WORDS = re.compile(
    r"\b(delete|remove|logout|sign out|pay|purchase|buy|transfer|send|post|"
    r"publish|submit|unsubscribe|cancel subscription|accept|agree)\b",
    re.IGNORECASE,
)

AUTHENTICATION_WORDS = re.compile(
    r"\b(log[ -]?in|sign[ -]?in|sign[ -]?up|register|create account|"
    r"forgot password|one[ -]?time password|otp|verify (?:email|phone))\b",
    re.IGNORECASE,
)


def is_authentication_action(action: Action | dict[str, Any]) -> bool:
    value = asdict(action) if isinstance(action, Action) else action
    searchable = " ".join(
        (str(value.get("label", "")), str(value.get("context", "")))
    )
    return bool(AUTHENTICATION_WORDS.search(searchable))


def run_adb(
    serial: str,
    binary: str,
    *args: str,
    check: bool = True,
    timeout: float = 15.0,
) -> str:
    result = subprocess.run(
        [binary, "-s", serial, *args],
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
    )
    return result.stdout


def dump_hierarchy(serial: str, binary: str) -> str:
    for attempt in range(2):
        try:
            hierarchy = run_adb(
                serial,
                binary,
                "exec-out",
                "uiautomator",
                "dump",
                "/dev/tty",
                timeout=5.0,
            )
            start = hierarchy.find("<?xml")
            end = hierarchy.rfind("</hierarchy>")
            if start >= 0 and end >= start:
                return hierarchy[start : end + len("</hierarchy>")]
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 0:
                run_adb(
                    serial,
                    binary,
                    "shell",
                    "pkill",
                    "-f",
                    "uiautomator",
                    check=False,
                    timeout=2.0,
                )
    raise RuntimeError("Android UI hierarchy capture failed twice")


def wait_for_stability(serial: str, binary: str, timeout: float = 5.0) -> str:
    deadline = time.monotonic() + timeout
    previous = ""
    stable_count = 0
    latest = ""
    while time.monotonic() < deadline:
        try:
            latest = dump_hierarchy(serial, binary)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError):
            time.sleep(0.2)
            continue
        current = fingerprint(latest)
        if current == previous:
            stable_count += 1
            if stable_count >= 2:
                return latest
        else:
            stable_count = 0
            previous = current
        time.sleep(0.2)
    return latest or dump_hierarchy(serial, binary)


LOADING_SIGNAL = re.compile(
    r'(?:class="[^"]*(?:ProgressBar|RefreshProgressIndicator)"|'
    r'(?:text|content-desc)="[^"]*\b(?:loading|please wait)\b)',
    re.IGNORECASE,
)


def observe_after_action(
    serial: str, binary: str, timeout: float = 3.0
) -> str:
    time.sleep(0.35)
    hierarchy = dump_hierarchy(serial, binary)
    if not LOADING_SIGNAL.search(hierarchy):
        return hierarchy
    deadline = time.monotonic() + timeout
    previous = fingerprint(hierarchy)
    while time.monotonic() < deadline:
        time.sleep(0.35)
        hierarchy = dump_hierarchy(serial, binary)
        current = fingerprint(hierarchy)
        if not LOADING_SIGNAL.search(hierarchy) or current == previous:
            return hierarchy
        previous = current
    return hierarchy


def screen_schema_key(actions: list[Action]) -> str:
    schema = sorted(
        (
            action.class_name,
            re.sub(r"\d+", "<n>", action.label.casefold()),
        )
        for action in actions
        if action.class_name != "__scroll__"
    )
    return hashlib.sha256(
        json.dumps(schema, separators=(",", ":")).encode()
    ).hexdigest()


def semantic_state_id(hierarchy: str, actions: list[Action]) -> str:
    root = ET.fromstring(hierarchy)
    controls: list[tuple[str, str]] = []
    for node in root.iter("node"):
        if (
            node.attrib.get("clickable") != "true"
            or node.attrib.get("enabled") != "true"
        ):
            continue
        labels: list[str] = []
        for descendant in node.iter():
            for attribute in ("text", "content-desc"):
                value = descendant.attrib.get(attribute, "").strip()
                if value and value not in labels:
                    labels.append(value)
        label = " ".join(labels[:3]) or node.attrib.get(
            "resource-id", ""
        ).rsplit("/", 1)[-1]
        controls.append(
            (
                node.attrib.get("class", ""),
                re.sub(r"\d+", "<n>", label.casefold()),
            )
        )
    visible = [
        re.sub(r"\d+", "<n>", value.strip().casefold())
        for value in re.findall(
            r'\b(?:text|content-desc)="([^"]+)"', hierarchy
        )
        if value.strip()
    ][:3]
    payload = {
        "controls": sorted(controls),
        "anchors": visible,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def action_key(action: Action | dict[str, Any]) -> tuple[str, str, str]:
    value = asdict(action) if isinstance(action, Action) else action
    return (
        str(value.get("class_name", "")),
        str(value.get("label", "")).casefold(),
        str(value.get("bounds", "")),
    )


def is_immediate_loop(
    path: list[dict[str, Any]], action: Action | dict[str, Any]
) -> bool:
    return bool(path and action_key(path[-1])[:2] == action_key(action)[:2])


def semantic_action_key(
    scope: str,
    action: Action | dict[str, Any],
    classification: dict[str, Any] | None,
) -> str | None:
    if classification:
        return None
    value = asdict(action) if isinstance(action, Action) else action
    if value.get("class_name") == "__scroll__":
        return None
    label = re.sub(r"\s+", " ", str(value.get("label", "")).casefold()).strip()
    class_name = str(value.get("class_name", ""))
    if not label:
        return None
    return f"{scope.casefold()}|{class_name}|{label}"


def card_equivalence_key(
    screen_name: str,
    action: Action | dict[str, Any],
    classification: dict[str, Any] | None,
) -> tuple[str, str] | None:
    if not classification:
        return None
    value = asdict(action) if isinstance(action, Action) else action
    label = str(value.get("label", "")).strip()
    class_name = str(value.get("class_name", ""))
    collection = re.sub(
        r"\s+", " ", str(classification.get("collection", "")).casefold()
    ).strip()
    variant = re.sub(
        r"\s+", " ", str(classification.get("variant", "")).casefold()
    ).strip()
    if not label or class_name == "__scroll__" or not collection or not variant:
        return None
    action_role = re.sub(r"\s+", " ", label.casefold())
    if collection == "calendar dates" and FULL_DATE_LABEL.fullmatch(label):
        action_role = "<date>"
    return (
        f"{screen_name.casefold()}|{collection}|{class_name}|{variant}|{action_role}",
        variant,
    )


class RepresentativeSampler:
    def __init__(self) -> None:
        self.groups: dict[str, SamplingGroup] = {}

    def accept(
        self,
        screen_name: str,
        action: Action | dict[str, Any],
        classification: dict[str, Any] | None = None,
    ) -> bool:
        grouped = card_equivalence_key(screen_name, action, classification)
        if grouped is None:
            return True
        key, variant = grouped
        value = asdict(action) if isinstance(action, Action) else action
        label = str(value.get("label", ""))
        if key not in self.groups:
            self.groups[key] = SamplingGroup(
                key=key,
                screen_name=screen_name,
                variant=variant,
                representative=label,
                skipped=[],
            )
            return True
        self.groups[key].skipped.append(label)
        return False

    def records(self) -> list[dict[str, Any]]:
        return [asdict(group) for group in self.groups.values()]


def best_match(actions: list[Action], selector: dict[str, Any]) -> Action | None:
    key = action_key(selector)
    for action in actions:
        if not action.selected and action_key(action) == key:
            return action
    label = str(selector.get("label", "")).casefold()
    same_label = [
        action
        for action in actions
        if not action.selected and action.label.casefold() == label
    ]
    return same_label[0] if len(same_label) == 1 else None


def perform_action(serial: str, binary: str, action: Action | dict[str, Any]) -> None:
    value = asdict(action) if isinstance(action, Action) else action
    if value.get("class_name") == "__scroll__":
        x = int(value["x"])
        y = int(value["y"])
        run_adb(
            serial,
            binary,
            "shell",
            "input",
            "swipe",
            str(x),
            str(y + 180),
            str(x),
            str(max(120, y - 220)),
            "350",
        )
    else:
        run_adb(
            serial,
            binary,
            "shell",
            "input",
            "tap",
            str(value["x"]),
            str(value["y"]),
        )


def with_scroll_actions(actions: list[Action], hierarchy: str) -> list[Action]:
    scroll_bounds = re.findall(
        r'<node[^>]*scrollable="true"[^>]*bounds="(\[\d+,\d+]\[\d+,\d+])"',
        hierarchy,
    )
    result = list(actions)
    for bounds in scroll_bounds:
        match = re.fullmatch(r"\[(\d+),(\d+)]\[(\d+),(\d+)]", bounds)
        if not match:
            continue
        x1, y1, x2, y2 = map(int, match.groups())
        result.append(
            Action(
                index=len(result),
                label="Scroll forward",
                class_name="__scroll__",
                bounds=bounds,
                x=(x1 + x2) // 2,
                y=(y1 + y2) // 2,
                risk="safe",
            )
        )
    return result


def foreground_package(serial: str, binary: str) -> str | None:
    output = run_adb(serial, binary, "shell", "dumpsys", "window")
    match = re.search(r"mCurrentFocus=.*? ([A-Za-z0-9._]+)/", output)
    return match.group(1) if match else None


def foreground_component(serial: str, binary: str) -> str | None:
    output = run_adb(serial, binary, "shell", "dumpsys", "window")
    match = re.search(r"mCurrentFocus=.*? ([A-Za-z0-9._]+/[A-Za-z0-9._$]+)", output)
    return match.group(1) if match else None


def navigate_in_session(
    serial: str,
    package: str,
    binary: str,
    current_path: list[dict[str, Any]],
    target_path: list[dict[str, Any]],
    target_state_id: str,
    hierarchy: str,
) -> tuple[bool, str]:
    actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
    if semantic_state_id(hierarchy, actions) == target_state_id:
        return True, hierarchy
    common = 0
    for current, target in zip(current_path, target_path):
        if action_key(current) != action_key(target):
            break
        common += 1
    for _ in range(len(current_path) - common):
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        back_actions = [
            action
            for action in actions
            if action.label.casefold()
            in {"back", "close", "navigate up", "close sheet"}
        ]
        contextual_exit = next(
            (
                action
                for action in actions
                if action.label.casefold() == "exit"
                and re.search(
                    r"\b(quiz|test|exam|question|practice|timer)\b",
                    action.context,
                    re.IGNORECASE,
                )
            ),
            None,
        )
        if contextual_exit:
            back_actions.insert(0, contextual_exit)
        if not back_actions:
            return False, hierarchy
        perform_action(serial, binary, back_actions[0])
        hierarchy = observe_after_action(serial, binary)
        if foreground_package(serial, binary) != package:
            return False, hierarchy
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        if semantic_state_id(hierarchy, actions) == target_state_id:
            return True, hierarchy
    for selector in target_path[common:]:
        if is_authentication_action(selector):
            return False, hierarchy
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        action = best_match(actions, selector)
        if action is None:
            return False, hierarchy
        perform_action(serial, binary, action)
        hierarchy = observe_after_action(serial, binary)
        if foreground_package(serial, binary) != package:
            return False, hierarchy
    actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
    return semantic_state_id(hierarchy, actions) == target_state_id, hierarchy


def recover_from_visible_root(
    serial: str,
    package: str,
    binary: str,
    root_state_id: str,
    target_path: list[dict[str, Any]],
    target_state_id: str,
) -> tuple[bool, str, str, list[dict[str, Any]]]:
    """Recover a clean navigation baseline and replay a route without relaunching."""
    hierarchy = discover_visible_root(serial, package, binary)
    actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
    current_state_id = semantic_state_id(hierarchy, actions)
    if current_state_id != root_state_id:
        return False, hierarchy, current_state_id, []
    if target_state_id == root_state_id:
        return True, hierarchy, root_state_id, []

    replayed: list[dict[str, Any]] = []
    for selector in target_path:
        if is_authentication_action(selector):
            return False, hierarchy, root_state_id, replayed
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        action = best_match(actions, selector)
        if action is None:
            return False, hierarchy, root_state_id, replayed
        perform_action(serial, binary, action)
        hierarchy = observe_after_action(serial, binary)
        if foreground_package(serial, binary) != package:
            return False, hierarchy, "", replayed
        replayed.append(asdict(action))
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        current_state_id = semantic_state_id(hierarchy, actions)
        if current_state_id == target_state_id:
            return True, hierarchy, target_state_id, replayed
    return False, hierarchy, current_state_id, replayed


def root_navigation_action(actions: list[Action]) -> Action | None:
    home = next(
        (
            action
            for action in actions
            if not action.selected and action.label.casefold() == "home"
        ),
        None,
    )
    escape = next(
        (
            action
            for action in actions
            if not action.selected
            and (
                action.label.casefold()
                in {"close", "cancel", "dismiss", "back", "navigate up"}
                or action.label.casefold().startswith("close ")
            )
        ),
        None,
    )
    contextual_exit = next(
        (
            action
            for action in actions
            if action.label.casefold() == "exit"
            and re.search(
                r"\b(quiz|test|exam|question|practice|timer)\b",
                action.context,
                re.IGNORECASE,
            )
        ),
        None,
    )
    return home or contextual_exit or escape


def discover_visible_root(
    serial: str,
    package: str,
    binary: str,
    max_steps: int = 12,
) -> str:
    hierarchy = wait_for_stability(serial, binary, timeout=3.0)
    seen: set[str] = set()
    for _ in range(max_steps):
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        state = fingerprint(hierarchy)
        if state in seen:
            return hierarchy
        seen.add(state)
        action = root_navigation_action(actions)
        if action is None:
            return hierarchy
        perform_action(serial, binary, action)
        hierarchy = observe_after_action(serial, binary)
        if foreground_package(serial, binary) != package:
            raise RuntimeError(
                "visible in-app root discovery left the target package"
            )
    return hierarchy


def pop_fair_frontier(
    frontier: deque[FrontierItem],
    states: dict[str, StateRecord],
    current_screen: str,
    consecutive_on_screen: int,
    limit: int = 4,
) -> FrontierItem:
    if consecutive_on_screen < limit:
        return frontier.popleft()
    for index, item in enumerate(frontier):
        source = states.get(item.source_id)
        if source and source.screen_name != current_screen:
            frontier.rotate(-index)
            selected = frontier.popleft()
            frontier.rotate(index)
            return selected
    return frontier.popleft()


def state_issues(
    state_id: str,
    hierarchy: str,
    actions: list[Action],
    screenshot: str,
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    display_bounds = re.search(
        r'<node[^>]*bounds="\[0,0]\[(\d+),(\d+)]"', hierarchy
    )
    display_height = int(display_bounds.group(2)) if display_bounds else 0
    semantic_labels = [
        action for action in actions if action.class_name != "__scroll__"
    ]
    for action in semantic_labels:
        match = re.fullmatch(r"\[(\d+),(\d+)]\[(\d+),(\d+)]", action.bounds)
        dimensions = tuple(map(int, match.groups())) if match else None
        if dimensions and display_height and dimensions[3] >= display_height:
            continue
        if dimensions and action.label != "Unlabelled control":
            x1, y1, x2, y2 = dimensions
            if x2 - x1 < 48 or y2 - y1 < 48:
                issues.append(
                    {
                        "category": "accessibility",
                        "severity": "warning",
                        "confidence": 95,
                        "state_id": state_id,
                        "title": f"Touch target may be too small: {action.label}",
                        "evidence": {
                            "action": asdict(action),
                            "bounds": action.bounds,
                            "screenshot": screenshot,
                        },
                    }
                )
    visible_text = re.findall(r'\b(?:text|content-desc)="([^"]+)"', hierarchy)
    if not [text for text in visible_text if text.strip()]:
        issues.append(
            {
                "category": "layout",
                "severity": "major",
                "confidence": 90,
                "state_id": state_id,
                "title": "Application screen has no visible semantic content",
                "evidence": {"screenshot": screenshot},
            }
        )
    return issues


def transition_issues(
    source_id: str,
    destination_id: str,
    action: dict[str, Any],
    latency_ms: int,
    screenshot: str,
    screen_name: str,
    path: list[dict[str, Any]],
    observable_effects: list[str],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if (
        not observable_effects
        and action.get("class_name") != "__scroll__"
    ):
        issues.append(
            {
                "category": "navigation",
                "severity": "major",
                "confidence": 90,
                "state_id": source_id,
                "screen_name": screen_name,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                "title": f"Control produced no observable effect: {action['label']}",
                "symptom": (
                    "The control accepted a tap, but the UI hierarchy, foreground "
                    "activity, package, and captured network/runtime signals did not change."
                ),
                "likely_causes": [
                    "The click handler is missing or not connected.",
                    "The handler returned early because required state was unavailable.",
                    "The control is visually enabled while its action is disabled.",
                ],
                "reproduction": {
                    "navigation_path": path,
                    "action": action,
                },
                "developer_next_steps": [
                    "Verify the control's click listener or callback is registered.",
                    "Inspect guard clauses and disabled/loading state for this action.",
                    "Add an observable success or error state and a regression test.",
                ],
                "evidence": {
                    "action": action,
                    "screenshot": screenshot,
                    "source_state": source_id,
                    "destination_state": destination_id,
                    "observable_effects": observable_effects,
                    "observation_window_ms": latency_ms,
                },
            }
        )
    # UIAutomator stability polling adds several seconds on its own. Only flag
    # extreme observations until device-side timing is isolated from capture.
    if latency_ms > 10000:
        issues.append(
            {
                "category": "performance",
                "severity": "minor",
                "confidence": 85,
                "state_id": destination_id,
                "title": f"Slow transition after {action['label']}",
                "evidence": {"latency_ms": latency_ms, "screenshot": screenshot},
            }
        )
    return issues


def deduplicate_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for issue in issues:
        key = (issue["category"], issue["title"], issue["state_id"])
        if key not in grouped:
            grouped[key] = {
                **issue,
                "occurrences": 1,
                "occurrence_details": [
                    {
                        "occurred_at": issue.get("occurred_at"),
                        "screen_name": issue.get("screen_name"),
                        "how_it_occurred": issue.get("how_it_occurred"),
                        "evidence": issue.get("evidence"),
                    }
                ],
            }
        else:
            grouped[key]["occurrences"] += 1
            grouped[key]["occurrence_details"].append(
                {
                    "occurred_at": issue.get("occurred_at"),
                    "screen_name": issue.get("screen_name"),
                    "how_it_occurred": issue.get("how_it_occurred"),
                    "evidence": issue.get("evidence"),
                }
            )
    ordered = list(grouped.values())
    severity = {"blocker": 0, "major": 1, "minor": 2, "warning": 3}
    ordered.sort(key=lambda item: severity.get(item["severity"], 9))
    for index, issue in enumerate(ordered, 1):
        issue["id"] = f"QA-{index:03}"
    return ordered


def make_actionable(
    issue: dict[str, Any], states: dict[str, StateRecord]
) -> dict[str, Any]:
    state = states.get(issue["state_id"])
    category = issue["category"]
    defaults = {
        "accessibility": {
            "causes": [
                "The component is missing a content description or semantic label.",
                "The visual hit area does not match the accessible control bounds.",
            ],
            "next": [
                "Add a stable accessible label describing the control's action.",
                "Ensure the touch target is at least 48×48 dp without overlapping controls.",
                "Add an accessibility assertion for this screen.",
            ],
        },
        "parsing": {
            "causes": [
                "The API response shape does not match the DTO or serializer contract.",
                "A nullable, enum, or numeric field is stricter than the server payload.",
            ],
            "next": [
                "Replay the redacted curl against the same environment.",
                "Compare the captured response with the named DTO/serializer.",
                "Add the payload as a parser regression fixture before adjusting the contract.",
            ],
        },
        "strict_mode": {
            "causes": [
                "Disk, network, or other blocking work ran on a policy-restricted thread.",
                "A lifecycle callback synchronously invoked an expensive dependency.",
            ],
            "next": [
                "Use the stack excerpt to identify the first application-owned frame.",
                "Move blocking work to an appropriate dispatcher/executor.",
                "Add a StrictMode regression test for the reproduction flow.",
            ],
        },
        "layout": {
            "causes": [
                "The screen rendered without semantic content.",
                "Loading, empty, or error state handling did not produce visible UI.",
            ],
            "next": [
                "Inspect loading and error state branches for the recorded screen.",
                "Add a screenshot/semantics regression test for the reproduction state.",
            ],
        },
        "performance": {
            "causes": [
                "The action blocks on synchronous work or a slow dependency.",
                "The destination waits too long before exposing stable UI.",
            ],
            "next": [
                "Trace the recorded action through navigation and data loading.",
                "Measure device-side rendering and request latency separately.",
            ],
        },
        "navigation": {
            "causes": ["The navigation destination or action handler behaved unexpectedly."],
            "next": ["Reproduce the recorded path and inspect the action handler."],
        },
    }
    selected = defaults.get(category, defaults["navigation"])
    screen_name = issue.get("screen_name") or (
        state.screen_name if state else "Unknown screen"
    )
    symptom = issue.get("symptom") or issue["title"]
    if category == "accessibility" and issue["title"].startswith(
        "Clickable control has no accessible label"
    ):
        bounds = issue.get("evidence", {}).get("bounds", "unknown bounds")
        symptom = (
            f"On {screen_name}, the clickable control at {bounds} has no text, "
            "content description, or semantic label. Screen readers and UI "
            "automation cannot determine what the control does."
        )
    reproduction = issue.get("reproduction") or issue.get("how_it_occurred") or {
        "navigation_path": state.path if state else [],
        "action": issue.get("evidence", {}).get("action"),
    }
    return {
        **issue,
        "screen_name": screen_name,
        "symptom": symptom,
        "likely_causes": issue.get("likely_causes") or selected["causes"],
        "reproduction": reproduction,
        "developer_next_steps": issue.get("developer_next_steps")
        or selected["next"],
    }


def write_outputs(
    output: Path,
    metadata: dict[str, Any],
    states: dict[str, StateRecord],
    transitions: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    model_decisions: list[dict[str, Any]],
    frontier_remaining: int,
    sampling: list[dict[str, Any]],
    skipped_branches: list[dict[str, Any]],
    stop_reason: str,
) -> None:
    issue_list = [
        make_actionable(issue, states) for issue in deduplicate_issues(issues)
    ]
    graph = {
        "schema_version": 1,
        "states": [asdict(state) for state in states.values()],
        "transitions": transitions,
    }
    (output / "graph.json").write_text(json.dumps(graph, indent=2), encoding="utf-8")
    with (output / "issues.jsonl").open("w", encoding="utf-8") as handle:
        for issue in issue_list:
            handle.write(json.dumps(issue) + "\n")
    with (output / "transitions" / "transitions.jsonl").open(
        "w", encoding="utf-8"
    ) as handle:
        for transition in transitions:
            handle.write(json.dumps(transition) + "\n")
    with (output / "model-decisions.jsonl").open("w", encoding="utf-8") as handle:
        for decision in model_decisions:
            handle.write(json.dumps(decision) + "\n")
    mermaid = ["flowchart TD"]
    for state in states.values():
        name = state.screen_name.replace('"', "'")
        mermaid.append(f'  S{state.ordinal}["{state.ordinal}: {name}"]')
    for transition in transitions:
        source = states[transition["source"]].ordinal
        destination = states[transition["destination"]].ordinal
        label = str(transition["action"]["label"]).replace('"', "'")
        mermaid.append(f'  S{source} -->|"{label}"| S{destination}')
    (output / "graph.mmd").write_text("\n".join(mermaid) + "\n", encoding="utf-8")
    coverage = {
        "states_discovered": len(states),
        "actions_executed": len(transitions),
        "frontier_remaining": frontier_remaining,
        "skipped_branches": len(skipped_branches),
        "complete": frontier_remaining == 0 and not skipped_branches,
        "stop_reason": stop_reason,
    }
    (output / "coverage.json").write_text(
        json.dumps(coverage, indent=2), encoding="utf-8"
    )
    (output / "skipped-branches.json").write_text(
        json.dumps(skipped_branches, indent=2), encoding="utf-8"
    )
    sampling_summary = {
        "representatives_tested": len(sampling),
        "equivalent_actions_skipped": sum(
            len(group["skipped"]) for group in sampling
        ),
        "groups": sampling,
    }
    (output / "sampling.json").write_text(
        json.dumps(sampling_summary, indent=2), encoding="utf-8"
    )
    report_path = output / "agent_report.md"
    if not issue_list:
        report_path.unlink(missing_ok=True)
    else:
        report = [
            "# Actionable Android QA issues",
            "",
            f"- Package: `{metadata['package']}`",
            f"- Device: `{metadata['serial']}`",
            f"- Issues requiring action: {len(issue_list)}",
            "",
            "This file intentionally contains only confirmed issue packets.",
            "",
        ]
        for issue in issue_list:
            report.extend(
            [
                f"## {issue['id']} — {issue['title']}",
                "",
                f"**Severity:** {issue['severity'].title()}",
                f"**Confidence:** {issue['confidence']}%",
                f"**Screen:** {issue['screen_name']}",
                f"**Category:** {issue['category']}",
                "",
                "### What happened",
                "",
                issue["symptom"],
                "",
                "### Likely causes",
                "",
                *[f"- {cause}" for cause in issue["likely_causes"]],
                "",
                "### How to reproduce",
                "",
                f"```json\n{json.dumps(issue['reproduction'], indent=2)}\n```",
                "",
                "### Evidence",
                "",
                f"```json\n{json.dumps(issue['evidence'], indent=2)}\n```",
                "",
                "### Developer next steps",
                "",
                *[f"- {step}" for step in issue["developer_next_steps"]],
                "",
            ]
        )
        report_path.write_text("\n".join(report), encoding="utf-8")
    summary = {
        **metadata,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        **coverage,
        "issues": len(issue_list),
        "issue_report": "agent_report.md" if issue_list else None,
        **{key: value for key, value in sampling_summary.items() if key != "groups"},
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--max-states", type=int, default=30)
    parser.add_argument("--max-actions", type=int, default=100)
    parser.add_argument("--max-minutes", type=int, default=15)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or Path("scan-results") / f"autonomous-{stamp}"
    for name in ("hierarchies", "screenshots", "states", "transitions", "logs"):
        (output / name).mkdir(parents=True, exist_ok=True)
    metadata = {
        "schema_version": 1,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "serial": args.serial,
        "package": args.package,
        "model": "fast-local-semantics",
        "mode": "safe",
        "limits": {
            "max_states": args.max_states,
            "max_actions": args.max_actions,
            "max_minutes": args.max_minutes,
        },
    }
    (output / "run-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    metadata["model_device"] = "cpu"
    if foreground_package(args.serial, args.adb) != args.package:
        raise RuntimeError(
            f"{args.package} must already be open in the foreground before scanning"
        )
    hierarchy = discover_visible_root(
        args.serial, args.package, args.adb
    )
    hierarchy, screenshot = save_observation(
        args.serial, output, 0, args.adb, hierarchy
    )
    root_actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
    root_id = semantic_state_id(hierarchy, root_actions)
    root_semantics = fast_understand_screen(hierarchy, root_actions)
    semantic_cache: dict[str, dict[str, Any]] = {
        screen_schema_key(root_actions): root_semantics
    }
    states: dict[str, StateRecord] = {
        root_id: StateRecord(
            id=root_id,
            ordinal=0,
            path=[],
            hierarchy="hierarchies/state-000.xml",
            screenshot=str(screenshot.relative_to(output)),
            actions_found=len(root_actions),
            scrollables=sum(a.class_name == "__scroll__" for a in root_actions),
            screen_name=str(root_semantics["screen_name"]),
            purpose=str(root_semantics["purpose"]),
            flow_stage=str(root_semantics["flow_stage"]),
            semantic_confidence=int(root_semantics["confidence"]),
            semantic_evidence=list(root_semantics["evidence_anchors"]),
            semantic_action_variants=list(root_semantics["action_variants"]),
            semantic_preferred_action_index=int(
                root_semantics["preferred_action_index"]
            ),
        )
    }
    issues = state_issues(root_id, hierarchy, root_actions, str(screenshot.relative_to(output)))
    frontier: deque[FrontierItem] = deque()
    queued: set[tuple[str, tuple[str, str, str]]] = set()
    queued_semantic_actions: set[str] = set()
    tested_semantic_actions: set[str] = set()
    model_decisions: list[dict[str, Any]] = []
    sampler = RepresentativeSampler()

    def enqueue(
        state: StateRecord, actions: list[Action], *, prioritize: bool = False
    ) -> None:
        preferred_index = state.semantic_preferred_action_index
        preferred = (
            actions[preferred_index]
            if 0 <= preferred_index < len(actions)
            and not actions[preferred_index].selected
            and actions[preferred_index].risk == "safe"
            else next(
                (
                    action
                    for action in actions
                    if not action.selected and action.risk == "safe"
                ),
                None,
            )
        )
        decision = {
            "reason": (
                "Used the screen-understanding model's preferred action."
                if preferred_index >= 0
                else "Used deterministic first-safe fallback."
            ),
            "screen_understanding_reused": True,
        }
        model_decisions.append(
            {
                "state_id": state.id,
                "preferred_action": asdict(preferred) if preferred else None,
                "decision": decision,
            }
        )
        ordered = ([preferred] if preferred else []) + [
            action for action in actions if preferred is None or action_key(action) != action_key(preferred)
        ]
        eligible: list[FrontierItem] = []
        sampling_scope = (
            str(state.path[0].get("label", state.screen_name))
            if state.path
            else state.screen_name
        )
        variants_by_index = {
            int(variant["action_index"]): variant
            for variant in state.semantic_action_variants
        }
        for action in ordered:
            if action.risk != "safe" or RISKY_WORDS.search(action.label):
                continue
            if is_authentication_action(action):
                continue
            if action.selected:
                continue
            if is_immediate_loop(state.path, action):
                continue
            classification = variants_by_index.get(action.index)
            if not sampler.accept(sampling_scope, action, classification):
                continue
            semantic_key = semantic_action_key(
                f"{sampling_scope}|{state.screen_name}",
                action,
                classification,
            )
            if semantic_key and (
                semantic_key in queued_semantic_actions
                or semantic_key in tested_semantic_actions
            ):
                continue
            key = (state.id, action_key(action))
            if key in queued:
                continue
            queued.add(key)
            if semantic_key:
                queued_semantic_actions.add(semantic_key)
            eligible.append(
                FrontierItem(
                    source_id=state.id,
                    path=state.path,
                    action=asdict(action),
                    semantic_key=semantic_key,
                )
            )
        if prioritize:
            for entry in reversed(eligible):
                frontier.appendleft(entry)
        else:
            frontier.extend(eligible)

    enqueue(states[root_id], root_actions)
    transitions: list[dict[str, Any]] = []
    collector = LogcatCollector(args.serial, args.adb, args.package)
    deadline = (
        time.monotonic() + args.max_minutes * 60
        if args.max_minutes > 0
        else float("inf")
    )
    capture_ordinal = 1
    current_state_id = root_id
    current_hierarchy = hierarchy
    current_path: list[dict[str, Any]] = []
    last_destination_screen = states[root_id].screen_name
    consecutive_on_screen = 0
    skipped_branches: list[dict[str, Any]] = []

    while (
        frontier
        and (args.max_states <= 0 or len(states) < args.max_states)
        and (
            args.max_actions <= 0
            or len(transitions) < args.max_actions
        )
        and time.monotonic() < deadline
    ):
        item = pop_fair_frontier(
            frontier,
            states,
            states[current_state_id].screen_name
            if current_state_id in states
            else "",
            consecutive_on_screen,
        )
        if item.semantic_key and item.semantic_key in tested_semantic_actions:
            continue
        actual_source_id = item.source_id
        reused_session = current_state_id == item.source_id
        if (
            not reused_session
            and current_state_id in states
            and states[current_state_id].screen_name
            == states[item.source_id].screen_name
        ):
            live_actions = with_scroll_actions(
                discover_actions(current_hierarchy), current_hierarchy
            )
            if best_match(live_actions, item.action) is not None:
                actual_source_id = current_state_id
                reused_session = True
        source_hierarchy = current_hierarchy
        if not reused_session:
            restored, source_hierarchy = navigate_in_session(
                args.serial,
                args.package,
                args.adb,
                current_path,
                item.path,
                item.source_id,
                current_hierarchy,
            )
            if not restored:
                (
                    restored,
                    source_hierarchy,
                    recovered_state_id,
                    recovered_path,
                ) = recover_from_visible_root(
                    args.serial,
                    args.package,
                    args.adb,
                    root_id,
                    item.path,
                    item.source_id,
                )
                current_state_id = recovered_state_id
                current_hierarchy = source_hierarchy
                current_path = recovered_path
            if not restored:
                if item.restore_attempts < 2:
                    item.restore_attempts += 1
                    frontier.append(item)
                else:
                    skipped_branches.append(
                        {
                            "source": item.source_id,
                            "action": item.action,
                            "reason": (
                                "no visible in-app path after three "
                                "session states"
                            ),
                        }
                    )
                    if item.semantic_key:
                        queued_semantic_actions.discard(item.semantic_key)
                continue
            current_state_id = item.source_id
            current_hierarchy = source_hierarchy
            current_path = list(item.path)
        collector.collect(
            state_id=actual_source_id,
            screen_name=states[actual_source_id].screen_name,
            action=None,
            path=current_path,
        )
        current_actions = with_scroll_actions(
            discover_actions(source_hierarchy), source_hierarchy
        )
        action = best_match(current_actions, item.action)
        if action is None:
            if item.semantic_key:
                queued_semantic_actions.discard(item.semantic_key)
            continue
        source_fingerprint = fingerprint(source_hierarchy)
        component_before = foreground_component(args.serial, args.adb)
        started = time.monotonic()
        perform_action(args.serial, args.adb, action)
        if item.semantic_key:
            tested_semantic_actions.add(item.semantic_key)
        try:
            destination_hierarchy = observe_after_action(
                args.serial, args.adb
            )
        except subprocess.CalledProcessError:
            destination_hierarchy = wait_for_stability(
                args.serial, args.adb, timeout=3.0
            )
        latency_ms = round((time.monotonic() - started) * 1000)
        raw_logs, runtime_issues = collector.collect(
            state_id=actual_source_id,
            screen_name=states[actual_source_id].screen_name,
            action=asdict(action),
            path=current_path + [asdict(action)],
        )
        log_path = output / "logs" / f"transition-{len(transitions):03}.log"
        log_path.write_text(raw_logs, encoding="utf-8")
        issues.extend(runtime_issues)
        outside = foreground_package(args.serial, args.adb)
        component_after = foreground_component(args.serial, args.adb)
        if outside != args.package:
            issues.append(
                {
                    "category": "navigation",
                    "severity": "major",
                    "confidence": 100,
                    "state_id": actual_source_id,
                    "title": f"Action opened external package: {action.label}",
                    "evidence": {"package": outside, "action": asdict(action)},
                }
            )
            current_state_id = ""
            continue
        destination_actions = with_scroll_actions(
            discover_actions(destination_hierarchy), destination_hierarchy
        )
        destination_id = semantic_state_id(
            destination_hierarchy, destination_actions
        )
        observable_effects: list[str] = []
        if fingerprint(destination_hierarchy) != source_fingerprint:
            observable_effects.append("stable_ui_changed")
        if component_after != component_before:
            observable_effects.append("foreground_activity_changed")
        if re.search(r"-->\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+", raw_logs):
            observable_effects.append("network_request_observed")
        if runtime_issues:
            observable_effects.append("runtime_incident_observed")
        if destination_id not in states:
            # Avoid another UIAutomator dump: capture only persisted evidence
            # from the already-observed hierarchy plus a screenshot.
            saved_hierarchy, saved_screenshot = save_observation(
                args.serial,
                output,
                capture_ordinal,
                args.adb,
                destination_hierarchy,
            )
            destination_actions = with_scroll_actions(
                discover_actions(saved_hierarchy), saved_hierarchy
            )
            destination_id = semantic_state_id(
                saved_hierarchy, destination_actions
            )
            schema_key = screen_schema_key(destination_actions)
            semantics = semantic_cache.get(schema_key)
            if semantics is None:
                semantics = fast_understand_screen(
                    saved_hierarchy, destination_actions
                )
                semantic_cache[schema_key] = semantics
            state = StateRecord(
                id=destination_id,
                ordinal=len(states),
                path=current_path + [asdict(action)],
                hierarchy=f"hierarchies/state-{capture_ordinal:03}.xml",
                screenshot=str(saved_screenshot.relative_to(output)),
                actions_found=len(destination_actions),
                scrollables=sum(
                    candidate.class_name == "__scroll__"
                    for candidate in destination_actions
                ),
                screen_name=str(semantics["screen_name"]),
                purpose=str(semantics["purpose"]),
                flow_stage=str(semantics["flow_stage"]),
                semantic_confidence=int(semantics["confidence"]),
                semantic_evidence=list(semantics["evidence_anchors"]),
                semantic_action_variants=list(semantics["action_variants"]),
                semantic_preferred_action_index=int(
                    semantics["preferred_action_index"]
                ),
            )
            states[destination_id] = state
            issues.extend(
                state_issues(
                    destination_id,
                    saved_hierarchy,
                    destination_actions,
                    state.screenshot,
                )
            )
            enqueue(state, destination_actions, prioritize=True)
            capture_ordinal += 1
        current_state_id = destination_id
        current_hierarchy = destination_hierarchy
        current_path = current_path + [asdict(action)]
        transition = {
            "source": actual_source_id,
            "destination": destination_id,
            "action": asdict(action),
            "result": "changed"
            if destination_id != actual_source_id
            else "no_change",
            "latency_ms": latency_ms,
            "navigation_mode": "live_session"
            if reused_session
            else "in_session_restore",
            "screen": {
                "name": states[destination_id].screen_name,
                "purpose": states[destination_id].purpose,
                "flow_stage": states[destination_id].flow_stage,
            },
            "runtime_log": str(log_path.relative_to(output)),
            "observable_effects": observable_effects,
        }
        transitions.append(transition)
        destination_screen = states[destination_id].screen_name
        if destination_screen == last_destination_screen:
            consecutive_on_screen += 1
        else:
            last_destination_screen = destination_screen
            consecutive_on_screen = 1
        issues.extend(
            transition_issues(
                actual_source_id,
                destination_id,
                transition["action"],
                latency_ms,
                states[destination_id].screenshot,
                states[actual_source_id].screen_name,
                current_path,
                observable_effects,
            )
        )
        checkpoint = {
            "states": [asdict(state) for state in states.values()],
            "transitions": transitions,
            "frontier": [asdict(entry) for entry in frontier],
            "tested_semantic_actions": sorted(tested_semantic_actions),
            "skipped_branches": skipped_branches,
        }
        (output / "checkpoint.json").write_text(
            json.dumps(checkpoint, indent=2), encoding="utf-8"
        )
        print(
            f"states={len(states)} transitions={len(transitions)} "
            f"frontier={len(frontier)} mode={transition['navigation_mode']} "
            f"screen={states[destination_id].screen_name} action={action.label}",
            flush=True,
        )

    if frontier:
        if time.monotonic() >= deadline:
            stop_reason = "safety_timeout"
        elif args.max_states > 0 and len(states) >= args.max_states:
            stop_reason = "state_limit"
        elif args.max_actions > 0 and len(transitions) >= args.max_actions:
            stop_reason = "action_limit"
        else:
            stop_reason = "interrupted"
    elif skipped_branches:
        stop_reason = "unreachable_branches"
    else:
        stop_reason = "frontier_exhausted"

    write_outputs(
        output,
        metadata,
        states,
        transitions,
        issues,
        model_decisions,
        len(frontier),
        sampler.records(),
        skipped_branches,
        stop_reason,
    )
    print(f"Scan recorded at {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
