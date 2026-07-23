#!/usr/bin/env python3
"""Persistent, safety-first Android graph exploration using a local model."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from local_model_scan import (
    Action,
    adb,
    capture,
    choose_action,
    discover_actions,
    fingerprint,
    load_model,
)


@dataclass
class StateRecord:
    id: str
    ordinal: int
    path: list[dict[str, Any]]
    hierarchy: str
    screenshot: str
    actions_found: int
    scrollables: int


@dataclass
class FrontierItem:
    source_id: str
    path: list[dict[str, Any]]
    action: dict[str, Any]


RISKY_WORDS = re.compile(
    r"\b(delete|remove|logout|sign out|pay|purchase|buy|transfer|send|post|"
    r"publish|submit|unsubscribe|cancel subscription|accept|agree)\b",
    re.IGNORECASE,
)
NAVIGATION_WORDS = re.compile(
    r"\b(view|details?|all|home|class|exam|assignment|practice|settings?|"
    r"profile|notification|search|back|next|menu|tab|today|tomorrow|upcoming)\b",
    re.IGNORECASE,
)


def run_adb(serial: str, binary: str, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        [binary, "-s", serial, *args],
        capture_output=True,
        text=True,
        check=check,
    )
    return result.stdout


def launcher_component(serial: str, package: str, binary: str) -> str:
    output = run_adb(
        serial,
        binary,
        "shell",
        "cmd",
        "package",
        "query-activities",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
        package,
    )
    candidates = [
        line.strip()
        for line in output.splitlines()
        if line.strip().startswith(package) and "/" in line
    ]
    candidates.sort(
        key=lambda value: any(
            marker in value.casefold() for marker in ("leakcanary", "debug", "test")
        )
    )
    if not candidates:
        raise RuntimeError(f"{package} has no launcher activity")
    return candidates[0]


def launch_root(serial: str, package: str, binary: str) -> None:
    component = launcher_component(serial, package, binary)
    run_adb(serial, binary, "shell", "am", "force-stop", package)
    run_adb(serial, binary, "shell", "am", "start", "-W", "-n", component)
    wait_for_stability(serial, binary)


def dump_hierarchy(serial: str, binary: str) -> str:
    remote = "/sdcard/app-tester-window.xml"
    run_adb(serial, binary, "shell", "uiautomator", "dump", remote)
    return run_adb(serial, binary, "shell", "cat", remote)


def wait_for_stability(serial: str, binary: str, timeout: float = 5.0) -> str:
    deadline = time.monotonic() + timeout
    previous = ""
    stable_count = 0
    latest = ""
    while time.monotonic() < deadline:
        try:
            latest = dump_hierarchy(serial, binary)
        except subprocess.CalledProcessError:
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


def action_key(action: Action | dict[str, Any]) -> tuple[str, str, str]:
    value = asdict(action) if isinstance(action, Action) else action
    return (
        str(value.get("class_name", "")),
        str(value.get("label", "")).casefold(),
        str(value.get("bounds", "")),
    )


def best_match(actions: list[Action], selector: dict[str, Any]) -> Action | None:
    key = action_key(selector)
    for action in actions:
        if action_key(action) == key:
            return action
    label = str(selector.get("label", "")).casefold()
    same_label = [action for action in actions if action.label.casefold() == label]
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


def restore_path(
    serial: str,
    package: str,
    binary: str,
    path: list[dict[str, Any]],
) -> tuple[bool, str]:
    launch_root(serial, package, binary)
    hierarchy = wait_for_stability(serial, binary)
    for selector in path:
        actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
        action = best_match(actions, selector)
        if action is None:
            return False, hierarchy
        perform_action(serial, binary, action)
        hierarchy = wait_for_stability(serial, binary)
        if foreground_package(serial, binary) != package:
            return False, hierarchy
    return True, hierarchy


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
        if action.label == "Unlabelled control":
            issues.append(
                {
                    "category": "accessibility",
                    "severity": "warning",
                    "confidence": 100,
                    "state_id": state_id,
                    "title": "Clickable control has no accessible label",
                    "evidence": {"bounds": action.bounds, "screenshot": screenshot},
                }
            )
        if dimensions:
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
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if (
        source_id == destination_id
        and NAVIGATION_WORDS.search(str(action.get("label", "")))
        and action.get("class_name") != "__scroll__"
    ):
        issues.append(
            {
                "category": "navigation",
                "severity": "minor",
                "confidence": 70,
                "state_id": source_id,
                "title": f"Navigation control produced no observable change: {action['label']}",
                "evidence": {"action": action, "screenshot": screenshot},
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
            grouped[key] = {**issue, "occurrences": 1}
        else:
            grouped[key]["occurrences"] += 1
    ordered = list(grouped.values())
    severity = {"blocker": 0, "major": 1, "minor": 2, "warning": 3}
    ordered.sort(key=lambda item: severity.get(item["severity"], 9))
    for index, issue in enumerate(ordered, 1):
        issue["id"] = f"QA-{index:03}"
    return ordered


def write_outputs(
    output: Path,
    metadata: dict[str, Any],
    states: dict[str, StateRecord],
    transitions: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    model_decisions: list[dict[str, Any]],
    frontier_remaining: int,
) -> None:
    issue_list = deduplicate_issues(issues)
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
        mermaid.append(f'  S{state.ordinal}["State {state.ordinal}"]')
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
        "complete": frontier_remaining == 0,
    }
    (output / "coverage.json").write_text(
        json.dumps(coverage, indent=2), encoding="utf-8"
    )
    report = [
        "# Autonomous Android QA report",
        "",
        f"- Package: `{metadata['package']}`",
        f"- Device: `{metadata['serial']}`",
        f"- Local model: `{metadata['model']}`",
        f"- States discovered: {len(states)}",
        f"- Transitions recorded: {len(transitions)}",
        f"- Remaining frontier: {frontier_remaining}",
        f"- Issues: {len(issue_list)}",
        "",
        "## Ordered issues",
        "",
    ]
    if not issue_list:
        report.append("No high-confidence deterministic issues were detected.")
    for issue in issue_list:
        report.extend(
            [
                f"## {issue['id']} — {issue['title']}",
                "",
                f"**Severity:** {issue['severity'].title()}",
                f"**Confidence:** {issue['confidence']}%",
                f"**Category:** {issue['category'].title()}",
                f"**State:** `{issue['state_id']}`",
                f"**Occurrences:** {issue['occurrences']}",
                "",
                "### Evidence",
                "",
                f"```json\n{json.dumps(issue['evidence'], indent=2)}\n```",
                "",
            ]
        )
    (output / "agent_report.md").write_text("\n".join(report), encoding="utf-8")
    summary = {
        **metadata,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        **coverage,
        "issues": len(issue_list),
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
        "model": "Qwen/Qwen3-0.6B",
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

    tokenizer, model, device = load_model()
    metadata["model_device"] = device
    launch_root(args.serial, args.package, args.adb)
    hierarchy, screenshot = capture(args.serial, output, 0, args.adb)
    root_id = fingerprint(hierarchy)
    root_actions = with_scroll_actions(discover_actions(hierarchy), hierarchy)
    states: dict[str, StateRecord] = {
        root_id: StateRecord(
            id=root_id,
            ordinal=0,
            path=[],
            hierarchy="hierarchies/state-000.xml",
            screenshot=str(screenshot.relative_to(output)),
            actions_found=len(root_actions),
            scrollables=sum(a.class_name == "__scroll__" for a in root_actions),
        )
    }
    issues = state_issues(root_id, hierarchy, root_actions, str(screenshot.relative_to(output)))
    frontier: deque[FrontierItem] = deque()
    queued: set[tuple[str, tuple[str, str, str]]] = set()
    model_decisions: list[dict[str, Any]] = []

    def enqueue(state: StateRecord, actions: list[Action]) -> None:
        executed: set[tuple[str, str]] = set()
        preferred, decision = choose_action(tokenizer, model, device, actions, executed)
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
        for action in ordered:
            if action.risk != "safe" or RISKY_WORDS.search(action.label):
                continue
            key = (state.id, action_key(action))
            if key in queued:
                continue
            queued.add(key)
            frontier.append(
                FrontierItem(
                    source_id=state.id,
                    path=state.path,
                    action=asdict(action),
                )
            )

    enqueue(states[root_id], root_actions)
    transitions: list[dict[str, Any]] = []
    deadline = time.monotonic() + args.max_minutes * 60
    capture_ordinal = 1

    while (
        frontier
        and len(states) < args.max_states
        and len(transitions) < args.max_actions
        and time.monotonic() < deadline
    ):
        item = frontier.popleft()
        restored, source_hierarchy = restore_path(
            args.serial, args.package, args.adb, item.path
        )
        if not restored:
            transitions.append(
                {
                    "source": item.source_id,
                    "destination": item.source_id,
                    "action": item.action,
                    "result": "replay_failed",
                    "latency_ms": 0,
                }
            )
            continue
        current_actions = with_scroll_actions(
            discover_actions(source_hierarchy), source_hierarchy
        )
        action = best_match(current_actions, item.action)
        if action is None:
            continue
        started = time.monotonic()
        perform_action(args.serial, args.adb, action)
        destination_hierarchy = wait_for_stability(args.serial, args.adb)
        latency_ms = round((time.monotonic() - started) * 1000)
        outside = foreground_package(args.serial, args.adb)
        if outside != args.package:
            issues.append(
                {
                    "category": "navigation",
                    "severity": "major",
                    "confidence": 100,
                    "state_id": item.source_id,
                    "title": f"Action opened external package: {action.label}",
                    "evidence": {"package": outside, "action": asdict(action)},
                }
            )
            continue
        destination_id = fingerprint(destination_hierarchy)
        if destination_id not in states:
            saved_hierarchy, saved_screenshot = capture(
                args.serial, output, capture_ordinal, args.adb
            )
            destination_id = fingerprint(saved_hierarchy)
            destination_actions = with_scroll_actions(
                discover_actions(saved_hierarchy), saved_hierarchy
            )
            state = StateRecord(
                id=destination_id,
                ordinal=len(states),
                path=item.path + [asdict(action)],
                hierarchy=f"hierarchies/state-{capture_ordinal:03}.xml",
                screenshot=str(saved_screenshot.relative_to(output)),
                actions_found=len(destination_actions),
                scrollables=sum(
                    candidate.class_name == "__scroll__"
                    for candidate in destination_actions
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
            enqueue(state, destination_actions)
            capture_ordinal += 1
        transition = {
            "source": item.source_id,
            "destination": destination_id,
            "action": asdict(action),
            "result": "changed" if destination_id != item.source_id else "no_change",
            "latency_ms": latency_ms,
        }
        transitions.append(transition)
        issues.extend(
            transition_issues(
                item.source_id,
                destination_id,
                transition["action"],
                latency_ms,
                states[destination_id].screenshot,
            )
        )
        checkpoint = {
            "states": [asdict(state) for state in states.values()],
            "transitions": transitions,
            "frontier": [asdict(entry) for entry in frontier],
        }
        (output / "checkpoint.json").write_text(
            json.dumps(checkpoint, indent=2), encoding="utf-8"
        )
        print(
            f"states={len(states)} transitions={len(transitions)} "
            f"frontier={len(frontier)} action={action.label}",
            flush=True,
        )

    write_outputs(
        output,
        metadata,
        states,
        transitions,
        issues,
        model_decisions,
        len(frontier),
    )
    print(f"Scan recorded at {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
