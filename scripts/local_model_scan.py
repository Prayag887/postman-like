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

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

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
    adb(serial, "shell", "uiautomator", "dump", remote, binary=adb_binary)
    hierarchy = adb(serial, "shell", "cat", remote, binary=adb_binary)
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


def load_model() -> tuple[Any, Any, str]:
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


def choose_action(
    tokenizer: Any,
    model: Any,
    device: str,
    actions: list[Action],
    executed: set[tuple[str, str]],
) -> tuple[Action | None, dict[str, Any]]:
    eligible = [
        action
        for action in actions
        if action.risk == "safe" and (action.label.casefold(), action.bounds) not in executed
    ]
    if not eligible:
        return None, {"action_index": -1, "reason": "No untested safe action remains."}
    candidates = [
        {
            "action_index": position,
            "label": action.label,
            "role": action.class_name,
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
