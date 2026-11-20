#!/usr/bin/env python3
"""
Deterministic PreToolUse guard for Claude Code (TG Naydi AI-native SDLC).

Reads Claude Code hook JSON payload from stdin:
  { "tool_name": "...", "tool_input": { ... } }

Exits with code 2 and writes a clear explanation to stderr to STRICTLY BLOCK
prohibited actions. Logs every decision to .data/hook-audit.jsonl.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import platform
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PROTECTED_STATE_PATH = REPO_ROOT / ".claude" / "state" / "protected-tests.json"
AUDIT_LOG_PATH = REPO_ROOT / ".data" / "hook-audit.jsonl"

SECRET_FILE_RE = re.compile(
    r"(^|[\\/])(\.env(\.[A-Za-z0-9_.-]+)?|[^\\/]+\.session|secrets[\\/].+)$",
    re.IGNORECASE,
)

# Allow reading/editing .env.example explicitly (template with zero secrets)
ENV_EXAMPLE_RE = re.compile(r"(^|[\\/])\.env\.example$", re.IGNORECASE)

SHELL_SECRET_RE = re.compile(
    r"(?i)(\.env(?![A-Za-z0-9_.-]*example\b)|\.session\b|TELEGRAM_SESSION|TELEGRAM_API_HASH|UPSTASH_REDIS_REST_TOKEN|OPERATOR_ACCESS_KEY)"
)

SHELL_PUSH_MAIN_RE = re.compile(
    r"(?i)\bgit\s+push\b[^\n]*(\s+main\b|\s+master\b|\s+HEAD:main\b|\s+--force\b|\s+-f\b|\s+--force-with-lease\b)"
)

PROTECTED_STATE_EDIT_RE = re.compile(
    r"(^|[\\/])\.claude[\\/]state[\\/]protected-tests\.json$",
    re.IGNORECASE,
)


def normalize_rel_path(raw_path: str) -> str:
    if not raw_path:
        return ""
    p = Path(raw_path)
    try:
        resolved = p.resolve() if p.is_absolute() else (REPO_ROOT / p).resolve()
        rel = resolved.relative_to(REPO_ROOT.resolve())
        return rel.as_posix().lower()
    except Exception:
        return raw_path.replace("\\", "/").lstrip("./").lower()


def append_audit(decision: str, tool_name: str, reason: str, target: str) -> None:
    try:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "hook": "PreToolUse",
            "decision": decision,
            "tool_name": tool_name,
            "target": target[:200],
            "reason": reason,
        }
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        # Audit write error must never silently allow a forbidden action
        pass


def block(tool_name: str, reason: str, target: str) -> None:
    append_audit("BLOCK", tool_name, reason, target)
    print(f"[TG-NAYDI GUARD BLOCKED] {reason}", file=sys.stderr)
    sys.exit(2)


def allow(tool_name: str, reason: str, target: str) -> None:
    append_audit("ALLOW", tool_name, reason, target)
    sys.exit(0)


def load_protected_files() -> set[str]:
    if not PROTECTED_STATE_PATH.exists():
        return set()
    try:
        data = json.loads(PROTECTED_STATE_PATH.read_text(encoding="utf-8"))
        files = data.get("protectedFiles", [])
        return {normalize_rel_path(str(item)) for item in files if item}
    except Exception:
        # Fail-closed if lockfile exists but is corrupted
        return {"*"}


def os_sandbox_available() -> bool:
    system = platform.system().lower()
    if system == "darwin":
        return shutil.which("sandbox-exec") is not None
    if system == "linux":
        return shutil.which("bwrap") is not None
    # Native Windows lacks Seatbelt/bubblewrap OS sandbox
    return False


def main() -> None:
    raw = sys.stdin.read().strip()
    if not raw:
        allow("unknown", "empty stdin payload", "")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        block("unknown", f"Malformed PreToolUse JSON payload (fail-closed): {exc}", raw[:80])

    tool_name = str(payload.get("tool_name", "")).strip()
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}

    file_path = str(
        tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("Path")
        or ""
    ).strip()
    command = str(
        tool_input.get("command")
        or tool_input.get("CommandLine")
        or ""
    ).strip()

    # 1. Fail-closed OS sandbox enforcement check (Stage 06: unavailable sandbox must NOT fall back to allow)
    if os.environ.get("TGNAYDI_REQUIRE_SANDBOX") == "1" and tool_name in {"Bash", "PowerShell"}:
        if not os_sandbox_available():
            block(
                tool_name,
                "OS sandbox required (TGNAYDI_REQUIRE_SANDBOX=1) but Seatbelt/bubblewrap is unavailable on this host. Failing closed — run inside WSL2, Linux container, or GitHub Actions.",
                command,
            )

    # 2. Block reading/writing secret files (.env, .env.*, *.session, secrets/)
    if file_path:
        if SECRET_FILE_RE.search(file_path) and not ENV_EXAMPLE_RE.search(file_path):
            block(
                tool_name,
                f"Access to secret file '{file_path}' is prohibited by security policy (.env / *.session / secrets).",
                file_path,
            )

    # 3. Block shell commands accessing .env / *.session / secret env vars or pushing directly to main / force-pushing
    if tool_name in {"Bash", "PowerShell"} and command:
        if SHELL_SECRET_RE.search(command):
            block(
                tool_name,
                "Shell command references protected secret files or credentials (.env / *.session / secret env vars).",
                command,
            )
        if SHELL_PUSH_MAIN_RE.search(command):
            block(
                tool_name,
                "Direct push to main/master or force push is prohibited. Open a PR from a feature branch.",
                command,
            )

    # 4. Block editing protected test files during active bugfix lock
    protected = load_protected_files()
    if protected and tool_name in {"Edit", "Write", "MultiEdit"} and file_path:
        rel = normalize_rel_path(file_path)
        if "*" in protected:
            block(
                tool_name,
                "Protected-test lockfile (.claude/state/protected-tests.json) is malformed; blocking edits fail-closed.",
                file_path,
            )
        if rel in protected:
            block(
                tool_name,
                f"Test file '{rel}' is locked in .claude/state/protected-tests.json during bugfix. Fix production code without weakening the test.",
                file_path,
            )
        if PROTECTED_STATE_EDIT_RE.search(file_path) and os.environ.get("TGNAYDI_ALLOW_UNLOCK") != "1":
            block(
                tool_name,
                "Editing .claude/state/protected-tests.json while tests are locked requires explicit unlock (TGNAYDI_ALLOW_UNLOCK=1) after fix verification.",
                file_path,
            )

    # Also block shell mutation of locked test files during active bugfix
    if protected and tool_name in {"Bash", "PowerShell"} and command:
        cmd_norm = command.replace("\\", "/").lower()
        for locked in protected:
            if locked != "*" and locked in cmd_norm and re.search(
                r"(?i)(>|sed\s+-i|perl\s+-pi|Set-Content|Out-File|Add-Content|rm\s|Remove-Item|git\s+checkout\s+--)",
                command,
            ):
                block(
                    tool_name,
                    f"Shell command attempts to modify locked test file '{locked}' during bugfix.",
                    command,
                )

    allow(tool_name, "passed all PreToolUse guards", file_path or command)


if __name__ == "__main__":
    main()
