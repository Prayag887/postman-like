#!/usr/bin/env python3
"""Extract redacted, developer-actionable incidents from Android logcat."""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

SENSITIVE_HEADERS = re.compile(
    r"^(authorization|cookie|set-cookie|proxy-authorization|x-api-key)\s*:",
    re.IGNORECASE,
)
SENSITIVE_JSON_KEYS = re.compile(
    r'("(?:access_?token|refresh_?token|password|secret|api_?key|session)"\s*:\s*)"[^"]*"',
    re.IGNORECASE,
)
SENSITIVE_QUERY = re.compile(
    r"([?&](?:access_?token|refresh_?token|password|secret|api_?key|session)=)[^&\s]+",
    re.IGNORECASE,
)
LOG_PREFIX = re.compile(
    r"^\d+(?:\.\d+)?\s+\d+\s+\d+\s+[VDIWEF]\s+[^:]+:\s?"
)
REQUEST = re.compile(r"-->\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)")
RESPONSE = re.compile(r"<--\s+(\d{3})\s+(\S+)")
PARSE_FAILURE = re.compile(
    r"(JsonDataException|JsonSyntaxException|MismatchedInputException|"
    r"SerializationException|DecodingException|MalformedJsonException|"
    r"Unable to create converter|Expected .+ but was|parse(?:r|ing)? (?:error|exception|failed))",
    re.IGNORECASE,
)
STRICT_MODE = re.compile(
    r"(StrictMode.*(?:violation|policy)|android\.os\.strictmode\.\w+Violation|"
    r"StrictMode\$\w+Violation)",
    re.IGNORECASE,
)
DTO_NAME = re.compile(
    r"\b([A-Za-z_][A-Za-z0-9_$.]*(?:Dto|DTO|Response|Request|Model))\b"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(value: str) -> str:
    lines = []
    for line in value.splitlines():
        if SENSITIVE_HEADERS.search(line.strip()):
            name = line.split(":", 1)[0]
            lines.append(f"{name}: <redacted>")
        else:
            safe = SENSITIVE_JSON_KEYS.sub(r'\1"<redacted>"', line)
            lines.append(SENSITIVE_QUERY.sub(r"\1<redacted>", safe))
    return "\n".join(lines)


def strip_log_prefix(line: str) -> str:
    return LOG_PREFIX.sub("", line).strip()


def build_curl(method: str, url: str, headers: list[str], body: str | None) -> str:
    parts = ["curl", "-X", method, shlex.quote(redact(url))]
    for header in headers:
        safe = redact(header)
        parts.extend(["-H", shlex.quote(safe)])
    if body:
        parts.extend(["--data-raw", shlex.quote(redact(body))])
    return " ".join(parts)


def _request_context(lines: list[str], index: int) -> dict[str, Any] | None:
    for cursor in range(index, max(-1, index - 120), -1):
        match = REQUEST.search(lines[cursor])
        if not match:
            continue
        method, url = match.groups()
        headers: list[str] = []
        body_lines: list[str] = []
        for following in lines[cursor + 1 : min(index + 1, cursor + 80)]:
            text = strip_log_prefix(following)
            if REQUEST.search(text) or RESPONSE.search(text):
                break
            if re.match(r"^[A-Za-z0-9-]+:\s*.+", text):
                headers.append(text)
            elif text and not text.startswith("--> END"):
                body_lines.append(text)
        body = "\n".join(body_lines).strip() or None
        return {
            "method": method,
            "url": redact(url),
            "headers": [redact(header) for header in headers],
            "request_body": redact(body) if body else None,
            "curl": build_curl(method, url, headers, body),
        }
    return None


def _response_context(lines: list[str], index: int) -> dict[str, Any] | None:
    for cursor in range(index, max(-1, index - 120), -1):
        match = RESPONSE.search(lines[cursor])
        if not match:
            continue
        status, url = match.groups()
        body_lines: list[str] = []
        for following in lines[cursor + 1 : min(index + 1, cursor + 80)]:
            text = strip_log_prefix(following)
            if REQUEST.search(text) or RESPONSE.search(text):
                break
            if text and not text.startswith("<-- END"):
                body_lines.append(text)
        return {
            "status": int(status),
            "url": redact(url),
            "body": redact("\n".join(body_lines).strip()) or None,
        }
    return None


def analyze_logcat(
    raw: str,
    *,
    state_id: str,
    screen_name: str,
    action: dict[str, Any] | None,
    path: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    lines = [line for line in raw.splitlines() if line.strip()]
    incidents: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        excerpt = "\n".join(
            strip_log_prefix(item)
            for item in lines[max(0, index - 4) : min(len(lines), index + 8)]
        )
        if PARSE_FAILURE.search(line):
            request = _request_context(lines, index)
            response = _response_context(lines, index)
            dto = DTO_NAME.search(excerpt)
            incidents.append(
                {
                    "category": "parsing",
                    "severity": "major",
                    "confidence": 95,
                    "state_id": state_id,
                    "title": "API response could not be parsed",
                    "occurred_at": utc_now(),
                    "screen_name": screen_name,
                    "how_it_occurred": {
                        "action": action,
                        "navigation_path": path,
                    },
                    "evidence": {
                        "dto_parser": dto.group(1) if dto else None,
                        "curl": request["curl"] if request else None,
                        "request": request,
                        "response": response,
                        "log_excerpt": redact(excerpt),
                        "capture_limitations": [
                            name
                            for name, value in (
                                ("request/curl was not present in logcat", request),
                                ("response body was not present in logcat", response),
                                ("DTO/parser name was not identifiable", dto),
                            )
                            if not value
                        ],
                    },
                }
            )
        elif STRICT_MODE.search(line):
            incidents.append(
                {
                    "category": "strict_mode",
                    "severity": "major",
                    "confidence": 100,
                    "state_id": state_id,
                    "title": "Android StrictMode violation",
                    "occurred_at": utc_now(),
                    "screen_name": screen_name,
                    "how_it_occurred": {
                        "action": action,
                        "navigation_path": path,
                    },
                    "evidence": {"log_excerpt": redact(excerpt)},
                }
            )
    return incidents


@dataclass
class LogcatCollector:
    serial: str
    binary: str
    package: str
    since_epoch: float = 0.0

    def __post_init__(self) -> None:
        self.since_epoch = time.time()

    def collect(
        self,
        *,
        state_id: str,
        screen_name: str,
        action: dict[str, Any] | None,
        path: list[dict[str, Any]],
    ) -> tuple[str, list[dict[str, Any]]]:
        pid_result = subprocess.run(
            [self.binary, "-s", self.serial, "shell", "pidof", self.package],
            capture_output=True,
            text=True,
            check=False,
        )
        pids = pid_result.stdout.strip().split()
        if not pids:
            self.since_epoch = time.time()
            return "", []
        command = [
            self.binary,
            "-s",
            self.serial,
            "logcat",
            "-d",
            "-v",
            "epoch",
            "-T",
            f"{self.since_epoch:.3f}",
            "--pid",
            pids[0],
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        self.since_epoch = time.time()
        raw = result.stdout
        return raw, analyze_logcat(
            raw,
            state_id=state_id,
            screen_name=screen_name,
            action=action,
            path=path,
        )
