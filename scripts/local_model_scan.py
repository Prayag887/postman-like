#!/usr/bin/env python3
"""Run a small, safety-gated Android exploration pass with a local Qwen model."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MODEL_ID = "Qwen/Qwen3-0.6B"
BLOCKED_WORDS = {
    "accept",
    "agree",
    "buy",
    "cancel subscription",
    "confirm order",
    "delete",
    "logout",
    "message",
    "pay",
    "post",
    "publish",
    "purchase",
    "remove",
    "send",
    "submit",
    "transfer",
    "unsubscribe",
}
DYNAMIC_TEXT = re.compile(
    r"\b(?:\d{1,2}:\d{2}|[0-9a-f]{8}-[0-9a-f-]{27,}|(?:\d[ -]?){7,})\b",
    re.IGNORECASE,
)
BOUNDS = re.compile(r"\[(\d+),(\d+)]\[(\d+),(\d+)]")


@dataclass(frozen=True)
class Action:
    index: int
    label: str
    class_name: str
    bounds: str
    x: int
    y: int
    risk: str
    context: str = ""
    selected: bool = False


def adb(serial: str, *args: str, binary: str = "adb", text: bool = True) -> Any:
    result = subprocess.run(
        [binary, "-s", serial, *args],
        check=True,
        capture_output=True,
        text=text,
    )
    return result.stdout


def capture(serial: str, directory: Path, step: int, adb_binary: str) -> tuple[str, Path]:
    remote = "/sdcard/app-tester-window.xml"
    hierarchy = ""
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(5):
        try:
            adb(serial, "shell", "uiautomator", "dump", remote, binary=adb_binary)
            hierarchy = adb(
                serial, "shell", "cat", remote, binary=adb_binary
            )
            if hierarchy.strip():
                break
        except subprocess.CalledProcessError as error:
            last_error = error
        time.sleep(0.25 * (attempt + 1))
    if not hierarchy.strip():
        if last_error:
            raise last_error
        raise RuntimeError("UI hierarchy capture returned no content")
    return save_observation(
        serial, directory, step, adb_binary, hierarchy
    )


def save_observation(
    serial: str,
    directory: Path,
    step: int,
    adb_binary: str,
    hierarchy: str,
) -> tuple[str, Path]:
    hierarchy_path = directory / "hierarchies" / f"state-{step:03}.xml"
    hierarchy_path.write_text(hierarchy, encoding="utf-8")
    screenshot_path = directory / "screenshots" / f"state-{step:03}.png"
    screenshot_path.write_bytes(
        adb(serial, "exec-out", "screencap", "-p", binary=adb_binary, text=False)
    )
    return hierarchy, screenshot_path


def node_label(node: ET.Element) -> str:
    direct = " ".join(
        value.strip()
        for value in (
            node.attrib.get("text", ""),
            node.attrib.get("content-desc", ""),
            node.attrib.get("resource-id", "").rsplit("/", 1)[-1],
        )
        if value.strip()
    )
    if direct:
        return direct
    descendants: list[str] = []
    for child in node.iter():
        for key in ("text", "content-desc"):
            value = child.attrib.get(key, "").strip()
            if value and value not in descendants:
                descendants.append(value)
    return " ".join(descendants[:3]) or "Unlabelled control"


def discover_actions(hierarchy: str) -> list[Action]:
    root = ET.fromstring(hierarchy)
    parents = {child: parent for parent in root.iter() for child in parent}
    actions: list[Action] = []
    seen: set[tuple[str, str]] = set()
    for node in root.iter("node"):
        if node.attrib.get("clickable") != "true" or node.attrib.get("enabled") != "true":
            continue
        bounds = node.attrib.get("bounds", "")
        match = BOUNDS.fullmatch(bounds)
        if not match:
            continue
        x1, y1, x2, y2 = map(int, match.groups())
        if x2 <= x1 or y2 <= y1:
            continue
        label = node_label(node)
        context = ""
        parent = parents.get(node)
        if parent is not None:
            context_values: list[str] = []
            for descendant in parent.iter():
                for attribute in ("text", "content-desc"):
                    value = descendant.attrib.get(attribute, "").strip()
                    if value and value not in context_values:
                        context_values.append(value)
            context = " · ".join(context_values[:12])
        key = (label.casefold(), bounds)
        if key in seen:
            continue
        seen.add(key)
        lowered = label.casefold()
        risk = "blocked" if any(word in lowered for word in BLOCKED_WORDS) else "safe"
        actions.append(
            Action(
                index=len(actions),
                label=label[:160],
                class_name=node.attrib.get("class", ""),
                bounds=bounds,
                x=(x1 + x2) // 2,
                y=(y1 + y2) // 2,
                risk=risk,
                context=context[:500],
                selected=node.attrib.get("selected") == "true",
            )
        )
    return actions


def fingerprint(hierarchy: str) -> str:
    root = ET.fromstring(hierarchy)
    semantic: list[str] = []
    for node in root.iter("node"):
        values = (
            node.attrib.get("class", ""),
            node.attrib.get("resource-id", ""),
            DYNAMIC_TEXT.sub("<dynamic>", node.attrib.get("text", "")),
            DYNAMIC_TEXT.sub("<dynamic>", node.attrib.get("content-desc", "")),
            node.attrib.get("clickable", ""),
            node.attrib.get("selected", ""),
        )
        semantic.append("|".join(values))
    return hashlib.sha256("\n".join(semantic).encode()).hexdigest()


def infer_contextual_action_variants(actions: list[Action]) -> list[dict[str, Any]]:
    by_role: dict[tuple[str, str], list[Action]] = {}
    for action in actions:
        if not action.context or action.context == action.label:
            continue
        by_role.setdefault(
            (action.class_name, action.label.casefold()), []
        ).append(action)
    inferred: list[dict[str, Any]] = []
    for (_, label), candidates in by_role.items():
        if len(candidates) < 2:
            continue
        fields = [
            [part.strip() for part in action.context.split("·") if part.strip()]
            for action in candidates
        ]
        width = min(len(parts) for parts in fields)
        positions: list[tuple[float, int]] = []
        for position in range(width):
            values = [parts[position] for parts in fields]
            normalized = {DYNAMIC_TEXT.sub("<dynamic>", value).casefold() for value in values}
            if len(normalized) < 2:
                continue
            if any(value.casefold() == label for value in values):
                continue
            numeric_ratio = sum(
                bool(re.search(r"\d", value)) for value in values
            ) / len(values)
            average_words = sum(len(value.split()) for value in values) / len(values)
            # Short, non-numeric fields that vary in the same structural
            # position are usually badges, states, tiers, or content variants.
            positions.append(
                (average_words + numeric_ratio * 10 + position * 0.01, position)
            )
        if not positions:
            continue
        _, selected_position = min(positions)
        collection = f"{candidates[0].label} collection"
        for action, parts in zip(candidates, fields):
            inferred.append(
                {
                    "action_index": action.index,
                    "collection": collection,
                    "variant": parts[selected_position][:80],
                }
            )
    return inferred


def fast_understand_screen(
    hierarchy: str, actions: list[Action]
) -> dict[str, Any]:
    root = ET.fromstring(hierarchy)
    visible: list[str] = []
    classes: set[str] = set()
    for node in root.iter("node"):
        classes.add(node.attrib.get("class", ""))
        for key in ("text", "content-desc"):
            value = node.attrib.get(key, "").strip()
            if value and value not in visible:
                visible.append(value[:160])
    screen_name = visible[0] if visible else "Unknown screen"
    combined = " ".join(visible).casefold()
    if any("edittext" in value.casefold() for value in classes):
        flow_stage = "form"
    elif "setting" in combined:
        flow_stage = "settings"
    elif re.search(r"\b(error|failed|try again)\b", combined):
        flow_stage = "error"
    elif actions:
        flow_stage = "browse"
    else:
        flow_stage = "unknown"
    safe_actions = [
        action
        for action in actions
        if action.risk == "safe" and not action.selected
    ]
    preferred = safe_actions[0].index if safe_actions else -1
    action_names = ", ".join(action.label for action in safe_actions[:4])
    return {
        "screen_name": screen_name[:80],
        "purpose": (
            f"Explore visible content using {action_names}."
            if action_names
            else "Present the visible application state."
        ),
        "flow_stage": flow_stage,
        "confidence": 70 if visible else 0,
        "evidence_anchors": visible[:8],
        "action_variants": infer_contextual_action_variants(actions[:24]),
        "preferred_action_index": preferred,
        "engine": "fast_local_semantics",
    }


def load_model() -> tuple[Any, Any, str]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=dtype)
    model.to(device)
    model.eval()
    return tokenizer, model, device


def extract_json(text: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("model returned no JSON object")
    value = json.loads(match.group())
    if not isinstance(value.get("action_index"), int):
        raise ValueError("action_index must be an integer")
    if not isinstance(value.get("reason"), str):
        raise ValueError("reason must be a string")
    return value


def understand_screen(
    tokenizer: Any,
    model: Any,
    device: str,
    hierarchy: str,
    actions: list[Action],
) -> dict[str, Any]:
    import torch

    root = ET.fromstring(hierarchy)
    visible: list[str] = []
    for node in root.iter("node"):
        for key in ("text", "content-desc"):
            value = node.attrib.get(key, "").strip()
            if value and value not in visible:
                visible.append(value[:160])
    evidence = {
        "visible_text": visible[:40],
        "actions": [
            {
                "action_index": index,
                "label": action.label,
                "role": action.class_name,
                "context": action.context[:240],
            }
            for index, action in enumerate(actions[:24])
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "Summarize an Android screen using only supplied UI evidence. "
                "Return strict JSON with: screen_name (short noun phrase), "
                "purpose (one sentence), flow_stage (entry, browse, detail, form, "
                "confirmation, settings, error, or unknown), and confidence "
                "(integer 0-100). Also return action_variants as an array. For "
                "actions belonging to repeated collection items, include "
                "action_index, collection (a stable semantic family name), and "
                "variant (the visible state/type that makes this item meaningfully "
                "different). Infer variants from evidence such as badges, status, "
                "capabilities, or content shape; do not use a predefined taxonomy. "
                "Omit ordinary navigation and actions without collection context. "
                "Also return preferred_action_index for the safest useful "
                "read-only navigation action on this screen, or -1 when none "
                "exists. "
                "Do not invent app behavior."
            ),
        },
        {"role": "user", "content": json.dumps(evidence)},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=128,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    response = tokenizer.decode(
        output[0][inputs["input_ids"].shape[-1] :],
        skip_special_tokens=True,
    ).strip()
    try:
        match = re.search(r"\{.*\}", response, re.DOTALL)
        if not match:
            raise ValueError("model returned no JSON object")
        result = json.loads(match.group())
        required = ("screen_name", "purpose", "flow_stage", "confidence")
        if not all(key in result for key in required):
            raise ValueError("screen understanding omitted required fields")
        result["confidence"] = max(0, min(95, int(result["confidence"])))
        if result["flow_stage"] not in {
            "entry",
            "browse",
            "detail",
            "form",
            "confirmation",
            "settings",
            "error",
            "unknown",
        }:
            result["flow_stage"] = "unknown"
        if result["flow_stage"] == "unknown":
            class_names = {action.class_name for action in actions}
            combined = " ".join(visible).casefold()
            if any("edittext" in name.casefold() for name in class_names):
                result["flow_stage"] = "form"
            elif "setting" in combined:
                result["flow_stage"] = "settings"
            elif re.search(r"\b(error|failed|try again)\b", combined):
                result["flow_stage"] = "error"
            elif actions:
                result["flow_stage"] = "browse"
        result["evidence_anchors"] = visible[:8]
        variants = result.get("action_variants", [])
        if not isinstance(variants, list):
            variants = []
        role_counts: dict[tuple[str, str], int] = {}
        for action in actions[:24]:
            role = (action.class_name, action.label.casefold())
            role_counts[role] = role_counts.get(role, 0) + 1
        validated_variants: list[dict[str, Any]] = []
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            try:
                action_index = int(variant["action_index"])
                collection = str(variant["collection"]).strip()
                group = str(variant["variant"]).strip()
            except (KeyError, TypeError, ValueError):
                continue
            if (
                0 <= action_index < min(len(actions), 24)
                and collection
                and group
                and role_counts.get(
                    (
                        actions[action_index].class_name,
                        actions[action_index].label.casefold(),
                    ),
                    0,
                )
                >= 2
            ):
                validated_variants.append(
                    {
                        "action_index": action_index,
                        "collection": collection[:80],
                        "variant": group[:80],
                    }
                )
        inferred_variants = infer_contextual_action_variants(actions[:24])
        inferred_indices = {
            variant["action_index"] for variant in inferred_variants
        }
        result["action_variants"] = inferred_variants + [
            variant
            for variant in validated_variants
            if variant["action_index"] not in inferred_indices
        ]
        try:
            preferred_index = int(result.get("preferred_action_index", -1))
        except (TypeError, ValueError):
            preferred_index = -1
        result["preferred_action_index"] = (
            preferred_index
            if 0 <= preferred_index < min(len(actions), 24)
            and not actions[preferred_index].selected
            and actions[preferred_index].risk == "safe"
            else -1
        )
        result["raw_response"] = response
        return result
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        fallback = visible[0] if visible else "Unknown screen"
        return {
            "screen_name": fallback[:80],
            "purpose": "Insufficient semantic evidence for a reliable summary.",
            "flow_stage": "unknown",
            "confidence": 0,
            "evidence_anchors": visible[:8],
            "action_variants": infer_contextual_action_variants(actions[:24]),
            "preferred_action_index": -1,
            "validation_error": str(error),
            "raw_response": response,
        }


def choose_action(
    tokenizer: Any,
    model: Any,
    device: str,
    actions: list[Action],
    executed: set[tuple[str, str]],
) -> tuple[Action | None, dict[str, Any]]:
    import torch

    eligible = [
        action
        for action in actions
        if action.risk == "safe"
        and not action.selected
        and (action.label.casefold(), action.bounds) not in executed
    ]
    if not eligible:
        return None, {"action_index": -1, "reason": "No untested safe action remains."}
    candidates = [
        {
            "action_index": position,
            "label": action.label,
            "role": action.class_name,
            "context": action.context[:240],
        }
        for position, action in enumerate(eligible[:24])
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "You rank already safety-approved Android navigation actions. "
                "Prefer navigation, tabs, read-only cards, menus, and See All. "
                "Avoid forms and ambiguous controls. Return only strict JSON: "
                '{"action_index": integer, "reason": "short evidence-based reason"}.'
            ),
        },
        {"role": "user", "content": json.dumps({"candidates": candidates})},
    ]
    prompt = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=96,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    response = tokenizer.decode(
        output[0][inputs["input_ids"].shape[-1] :],
        skip_special_tokens=True,
    ).strip()
    try:
        decision = extract_json(response)
        chosen = decision["action_index"]
        if chosen < 0 or chosen >= len(candidates):
            raise ValueError("action index outside candidate range")
        return eligible[chosen], {**decision, "raw_response": response}
    except (ValueError, json.JSONDecodeError) as error:
        fallback = eligible[0]
        return fallback, {
            "action_index": 0,
            "reason": "Invalid model output; used deterministic first-safe fallback.",
            "validation_error": str(error),
            "raw_response": response,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = args.output or Path("scan-results") / f"local-model-{stamp}"
    for name in ("hierarchies", "screenshots", "states", "transitions", "diagnostics"):
        (output / name).mkdir(parents=True, exist_ok=True)

    metadata = {
        "schema_version": 1,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "serial": args.serial,
        "package": args.package,
        "model": MODEL_ID,
        "mode": "safe",
    }
    (output / "run-metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )

    print(f"Loading local model {MODEL_ID}…", flush=True)
    tokenizer, model, device = load_model()
    metadata["model_device"] = device
    executed: set[tuple[str, str]] = set()
    seen_states: set[str] = set()
    transitions: list[dict[str, Any]] = []

    for step in range(args.steps + 1):
        hierarchy, screenshot = capture(args.serial, output, step, args.adb)
        state_id = fingerprint(hierarchy)
        actions = discover_actions(hierarchy)
        state = {
            "step": step,
            "state_id": state_id,
            "screenshot": str(screenshot.relative_to(output)),
            "hierarchy": f"hierarchies/state-{step:03}.xml",
            "actions": [asdict(action) for action in actions],
            "new_state": state_id not in seen_states,
        }
        (output / "states" / f"state-{step:03}.json").write_text(
            json.dumps(state, indent=2), encoding="utf-8"
        )
        seen_states.add(state_id)
        if step == args.steps:
            break

        action, decision = choose_action(tokenizer, model, device, actions, executed)
        if action is None:
            break
        executed.add((action.label.casefold(), action.bounds))
        before = state_id
        started = time.monotonic()
        adb(args.serial, "shell", "input", "tap", str(action.x), str(action.y), binary=args.adb)
        time.sleep(0.7)
        next_hierarchy, _ = capture(args.serial, output, step + 1000, args.adb)
        after = fingerprint(next_hierarchy)
        transition = {
            "step": step,
            "before_state": before,
            "after_state": after,
            "action": asdict(action),
            "model_decision": decision,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "state_changed": before != after,
        }
        transitions.append(transition)
        with (output / "transitions" / "transitions.jsonl").open(
            "a", encoding="utf-8"
        ) as handle:
            handle.write(json.dumps(transition) + "\n")
        print(
            f"[{step + 1}/{args.steps}] {action.label}: "
            f"{'changed' if before != after else 'no change'}",
            flush=True,
        )

    summary = {
        **metadata,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "states_discovered": len(seen_states),
        "actions_executed": len(transitions),
        "transitions": transitions,
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(f"Scan recorded at {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
