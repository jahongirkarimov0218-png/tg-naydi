# A/B Agent Configuration & Skill-Trigger Eval Report

**Pinned Base Commit SHA:** `8110544` (`feat/tgn-001-mvp`)
**Date:** 2026-11-20
**Execution Runner:** Isolated Antigravity `research` subagents (Control conversation `571ab663`, Treatment conversation `4fde17a4`) — honestly documented because local `claude` CLI v2.1.283 reports `loggedIn: false` and pilot budget is `\$0`. The `claude -p --output-format json` runner is committed in `scripts/evals/run_claude_ab.mjs` and ready for immediate execution once `claude auth login` is run.

---

## 1. Experiment Setup

- **Variant A (Control):** Fresh isolated session inspecting ONLY `package.json`, `src/`, and `worker/` (zero access to `CLAUDE.md`, `.claude/skills/*`, `REVIEW.md`, `scripts/hooks/`, or `docs/`).
- **Variant B (Treatment):** Fresh isolated session starting from `CLAUDE.md`, `.claude/skills/csv-pii-safety/SKILL.md`, `.claude/skills/bugfix-protected-test/SKILL.md`, and `REVIEW.md`.
- **Benchmark Tasks (4 realistic rephrased prompts that NEVER mention skill names):**
  - **Q1 (CSV encoding & PII safety):** Russian Excel mojibake + zero phone leak into logs/API.
  - **Q2 (Excel export & mode honesty):** Formula injection protection without breaking `+7` / `@username` + Sandbox vs Live separation.
  - **Q3 (Bugfix discipline):** Step-by-step CRM phone parser bugfix procedure & guaranteeing regression tests are not weakened.
  - **Q4 (Maintain incident & Live limits):** Handling auto-generated `intent-INC-20261120.md`, GramJS/Vercel rules, unfound statuses, and flaky-test quarantine.

---

## 2. Objective Rubric Results (12 Binary Criteria)

| # | Criterion | Variant A (Control) | Variant B (Treatment) |
| :- | :--- | :---: | :---: |
| 1 | Uses `pnpm` (never `npm`/`npx`) | PASS | PASS |
| 2 | Names single-command gates `pnpm run check` & `pnpm run eval:domain` | PASS | PASS |
| 3 | Enforces strict UTF-8 + `windows-1251` fallback decoding | PASS | PASS |
| 4 | Enforces `src/lib/logger.ts` (`redactSensitiveText`) + masked-only `GET /api/jobs/[id]` | PASS | PASS |
| 5 | Enforces UTF-8 BOM (`\uFEFF`) + `mode` column stamp (`SANDBOX`/`LIVE_MTPROTO`) | PASS | PASS |
| 6 | Triggers `csv-pii-safety` on Q1 & Q2 rephrasings (2/2) | **FAIL** (`none known`) | **PASS** (2/2) |
| 7 | Triggers `bugfix-protected-test` on Q3 & Q4 rephrasings (2/2) | **FAIL** (`none known`) | **PASS** (2/2) |
| 8 | Uses `.claude/state/protected-tests.json` + `PreToolUse` `exit 2` test lock | **FAIL** | **PASS** |
| 9 | Enforces strict separation between bugfix and `flaky-quarantine` PR (`CODEOWNERS`) | **FAIL** | **PASS** |
| 10 | Forbids importing `telegram` (GramJS) in `src/app/` (standalone `worker/mtproto.ts`) | PASS | PASS |
| 11 | Enforces unified `not_found_or_hidden` status + `personal_channel_id` rule | PASS | PASS |
| 12 | Closes Maintain→Eval loop (`vercel rollback`, `plan.md` sync, append incident to `evals/domain-eval.test.ts`) | **FAIL** | **PASS** |
| | **Total Score** | **7 / 12 (58.3%)** | **12 / 12 (100.0%)** |
| | **Skill-Trigger Accuracy (4 rephrasings)** | **0 / 4 (0%)** | **4 / 4 (100%)** |

---

## 3. Key Takeaways & Actionable Hardening

1. **Measurable gain (+41.7 percentage points):** Reading code alone allowed Variant A to infer runtime invariants embedded in TypeScript, but Variant A completely missed process & governance safeguards (mechanical test locking via `protected-tests.json` + `exit 2`, `flaky-quarantine` PR separation, `plan.md` sync, and closing production incidents back into `evals/domain-eval.test.ts`). Variant B achieved 12/12 and 4/4 skill-trigger precision across all rephrasings.
2. **Bonus hardening findings surfaced during inspection (fed back into code & tests):**
   - `src/lib/logger.ts` (`sanitizeMeta`): upgraded to recursively sanitize nested objects and arrays so passing structured payloads cannot leak PII.
   - `src/lib/csv-exporter.ts` (`sanitizeCsvCell`): hardened against leading `\n` and leading-whitespace formula smuggling (e.g. `" =1+1"`), while keeping valid E.164 `+7...` and `@username` clean.
3. **Domain Eval Companion:** All 15 deterministic domain & policy cases in `evals/domain-eval.test.ts` pass (`15/15`, exit `0`).
