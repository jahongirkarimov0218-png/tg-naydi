#!/usr/bin/env python3
"""
PostToolUse audit hook for Claude Code (TG Naydi AI-native SDLC).
Records tool completion events to .data/hook-audit.jsonl without logging secrets.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AUDIT_LOG_PATH = REPO_ROOT / ".data" / "hook-audit.jsonl"


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        sys.exit(0)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = str(payload.get("tool_name", "unknown"))
    tool_input = payload.get("tool_input") or {}
    target = ""
    if isinstance(tool_input, dict):
        target = str(
            tool_input.get("file_path")
            or tool_input.get("path")
            or tool_input.get("command")
            or ""
        )[:160]

    try:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "hook": "PostToolUse",
            "tool_name": tool_name,
            "target": target,
        }
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
