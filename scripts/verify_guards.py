#!/usr/bin/env python3
"""
Adversarial verification suite for TG Naydi PreToolUse guards (Stage 06).

Runs scripts/hooks/pre_tool_guard.py as a real subprocess with Claude Code
PreToolUse JSON payloads on stdin and verifies:
  - Forbidden actions return exit code 2 + explanation on stderr
  - Allowed actions return exit code 0
  - Every decision is recorded in .data/hook-audit.jsonl
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GUARD_SCRIPT = REPO_ROOT / "scripts" / "hooks" / "pre_tool_guard.py"
LOCK_FILE = REPO_ROOT / ".claude" / "state" / "protected-tests.json"
AUDIT_LOG = REPO_ROOT / ".data" / "hook-audit.jsonl"


def run_guard(payload: dict, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("TGNAYDI_REQUIRE_SANDBOX", None)
    env.pop("TGNAYDI_ALLOW_UNLOCK", None)
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, str(GUARD_SCRIPT)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=str(REPO_ROOT),
        env=env,
        check=False,
    )


def main() -> None:
    failures: list[str] = []
    results: list[str] = []

    def expect(name: str, payload: dict, expected_code: int, extra_env: dict[str, str] | None = None) -> None:
        proc = run_guard(payload, extra_env)
        ok = proc.returncode == expected_code
        if expected_code == 2:
            ok = ok and ("[TG-NAYDI GUARD BLOCKED]" in proc.stderr)
        status = "PASS" if ok else "FAIL"
        detail = proc.stderr.strip() or "(no stderr)"
        results.append(f"[{status}] {name}: exit={proc.returncode} (expected {expected_code}) | {detail}")
        if not ok:
            failures.append(f"{name}: expected exit {expected_code}, got {proc.returncode} ({detail})")

    # 1. Secret access blocks (.env via Read, Bash, PowerShell, *.session)
    expect("Block Read(.env.local)", {"tool_name": "Read", "tool_input": {"file_path": ".env.local"}}, 2)
    expect("Block Bash(cat .env)", {"tool_name": "Bash", "tool_input": {"command": "cat .env"}}, 2)
    expect("Block PowerShell(Get-Content worker.session)", {"tool_name": "PowerShell", "tool_input": {"command": "Get-Content tg.session"}}, 2)
    expect("Allow Read(.env.example)", {"tool_name": "Read", "tool_input": {"file_path": ".env.example"}}, 0)

    # 2. Direct push to main / force push blocks
    expect("Block Bash(git push origin main)", {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}, 2)
    expect("Block Bash(git push --force origin feat/x)", {"tool_name": "Bash", "tool_input": {"command": "git push --force origin feat/x"}}, 2)
    expect("Allow Bash(pnpm run check)", {"tool_name": "Bash", "tool_input": {"command": "pnpm run check"}}, 0)

    # 3. Protected test lock during bugfix (both Edit and shell bypass attempt)
    previous_lock = LOCK_FILE.read_text(encoding="utf-8") if LOCK_FILE.exists() else None
    try:
        LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
        LOCK_FILE.write_text(
            json.dumps(
                {
                    "protectedFiles": ["tests/unit/phone-normalizer.test.ts"],
                    "reason": "Adversarial guard verification",
                }
            ),
            encoding="utf-8",
        )
        expect(
            "Block Edit(locked test file)",
            {"tool_name": "Edit", "tool_input": {"file_path": "tests/unit/phone-normalizer.test.ts"}},
            2,
        )
        expect(
            "Block Bash(shell redirect into locked test)",
            {"tool_name": "Bash", "tool_input": {"command": "echo 'skip' > tests/unit/phone-normalizer.test.ts"}},
            2,
        )
        expect(
            "Block unauthorized edit of protected-tests.json",
            {"tool_name": "Edit", "tool_input": {"file_path": ".claude/state/protected-tests.json"}},
            2,
        )
        expect(
            "Block PowerShell(Remove-Item protected-tests.json)",
            {"tool_name": "PowerShell", "tool_input": {"command": "Remove-Item -Force .claude/state/protected-tests.json"}},
            2,
        )
        expect(
            "Block Bash(rm protected-tests.json)",
            {"tool_name": "Bash", "tool_input": {"command": "rm -f .claude/state/protected-tests.json"}},
            2,
        )
        expect(
            "Allow Edit(production file while test locked)",
            {"tool_name": "Edit", "tool_input": {"file_path": "src/lib/phone-normalizer.ts"}},
            0,
        )
    finally:
        if previous_lock is None:
            if LOCK_FILE.exists():
                LOCK_FILE.unlink()
        else:
            LOCK_FILE.write_text(previous_lock, encoding="utf-8")

    # 4. Fail-closed check when OS sandbox is required on a host without Seatbelt/bubblewrap
    if platform.system().lower() == "windows":
        expect(
            "Fail-closed Bash when TGNAYDI_REQUIRE_SANDBOX=1 on Windows (no bubblewrap)",
            {"tool_name": "Bash", "tool_input": {"command": "echo hello"}},
            2,
            extra_env={"TGNAYDI_REQUIRE_SANDBOX": "1"},
        )
    else:
        results.append("[INFO] Non-Windows host detected; skipping Windows-specific unavailable-sandbox assertion.")

    # 5. Audit log verification
    if not AUDIT_LOG.exists() or AUDIT_LOG.stat().st_size == 0:
        failures.append("Audit log .data/hook-audit.jsonl was not written")
    else:
        lines = [line for line in AUDIT_LOG.read_text(encoding="utf-8").splitlines() if line.strip()]
        results.append(f"[PASS] Audit log recorded {len(lines)} entries in .data/hook-audit.jsonl")

    print("\n".join(results))
    if failures:
        print("\nFAILURES:\n- " + "\n- ".join(failures), file=sys.stderr)
        sys.exit(1)
    print("\nALL ADVERSARIAL GUARD CHECKS PASSED.")


if __name__ == "__main__":
    main()
