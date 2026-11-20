---
name: bugfix-protected-test
owner: TG Naydi Engineering Lead
source_policy: docs/sdlc/spec.md (§2 C7, §4.3) & REVIEW.md
description: >
  Enforces reproducing a bug with a failing test first, committing and locking
  the test file via `.claude/state/protected-tests.json` (enforced by PreToolUse
  hook exit 2), implementing the fix without weakening assertions, and verifying
  before unlocking.
  USE WHEN: fixing any bug, regression, edge-case failure, or production incident
  (`intent-INC-*.md`) in TG Naydi. NOT FOR quarantining flaky tests (which requires
  a separate `flaky-quarantine` PR with independent code-owner approval).
---

# Protected-Test Bugfix Skill

## Trigger Conditions
Activate this skill whenever you are asked to:
- Fix a bug, crash, broken parsing case, counter mismatch, or API regression.
- Resolve a monitoring incident recorded in `docs/sdlc/incidents/intent-INC-*.md`.
- Patch unexpected behavior reported by users or Playwright E2E failures.

## Mandatory Procedure

1. **Reproduce First (Red)**
   - Write a minimal, deterministic test that reproduces the exact failure symptom.
   - Run `pnpm exec vitest run <test-file>` (or `pnpm run test:e2e`) and observe the expected failure reason.

2. **Commit & Lock the Test**
   - Commit the failing test alone (`test: reproduce <symptom>`).
   - Register the test path in `.claude/state/protected-tests.json`:
     ```json
     {
       "protectedFiles": ["tests/unit/example.test.ts"],
       "reason": "Reproducing bug TGN-XXX — test must not be weakened during fix"
     }
     ```
   - While locked, `scripts/hooks/pre_tool_guard.py` mechanically blocks (`exit 2`) any edit to listed test files.

3. **Fix Implementation Only (Green)**
   - Patch ONLY production source files under `src/` or `worker/` (or `scripts/`).
   - Re-run the full check (`pnpm run check`) and attach actual command output.

4. **Unlock, Commit & Add to Evals**
   - Clear `.claude/state/protected-tests.json` (remove file or set `"protectedFiles": []`).
   - Commit the fix (`fix: <root cause>`).
   - For production/user incidents, append the regression case to `evals/domain-eval.test.ts`.

## Strict Separation from Flaky Quarantine
Never disable, skip, or relax a locked test during a bug fix. If a test is genuinely flaky, stop the bugfix route and open a separate PR labeled `flaky-quarantine` for independent review.
