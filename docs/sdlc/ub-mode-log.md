# `ub-mode` Engineering Quality Audit & Fix Log — TG Naydi

**Branch:** `feat/tgn-001-mvp` (worktree `d:\tg naydi\.worktrees\feat-tgn-001-mvp`)
**Baseline Commit SHA (BEFORE):** `b4aa623`
**Date:** 2026-11-20

---

## 1. Objective Machine Metrics: BEFORE vs AFTER (`ub-mode`)

| Sensor / Tool | BEFORE (`b4aa623`) | AFTER (`ub-mode`) | Delta / Verdict |
| :--- | :--- | :--- | :--- |
| **V8 Coverage (`src/lib`, `src/app/api`, `worker`)** | **67.61% Stmts / 68.20% Branch / 93.75% Funcs** | **90.30% Stmts / 91.07% Branch / 99.29% Funcs** (`src/lib`: **99.43% Stmts**) | **+22.69 pp Stmts / +22.87 pp Branch** (PASS) |
| **CRAP Score (`node scripts/quality/crap_report.mjs`)** | **22 functions >= 10** (worst: `worker/mtproto.ts:main` = **930**, `job-engine.ts:runSandboxJobStep` = **60.15**) | **0 functions >= 10** (max across all 158 functions = **9.00**, exit `0`) | **-22 offenders (100% eliminated)** (PASS) |
| **Structural Duplication (`jscpd --min-tokens 35`)** | **27 clones** (317 lines / 5.75% total, 7.81% TS) | **0 clones** (`0` lines / **0.00%** in `src` & `worker`) | **-27 clones (0.00%)** (PASS) |
| **Dead Code (`knip`)** | **10 unused exports**, **1 unused type**, **2 unused files** | **0 unused files, 0 unused exports, 0 unused types** (exit `0`) | **100% clean** (PASS) |
| **StrykerJS Mutation Score (8 `src/lib` files)** | **47.33% total** (541 killed, 425 survived, 177 no-cov) | **86.33% total (87.65% covered)** (859 killed, 121 survived, 15 no-cov) | **+39.00 pp** (`>= 85%` target met) (PASS) |
| **Unit + Integration Tests (`pnpm run test`)** | 29 passed | **53 passed (9 files, 0 failed)** | **+24 behavioral tests** (PASS) |

### StrykerJS Mutation Score Breakdown (BEFORE vs AFTER)

| File | BEFORE % | AFTER % | Delta | Killed / Survived / NoCov (AFTER) |
| :--- | :---: | :---: | :---: | :---: |
| `src/lib/csv-exporter.ts` | 59.26% | **95.65%** | +36.39 pp | 110 / 4 / 1 |
| `src/lib/auth.ts` | 57.14% | **95.00%** | +37.86 pp | 76 / 4 / 0 |
| `src/lib/providers/mtproto.ts` | 61.54% | **92.66%** | +31.12 pp | 101 / 7 / 1 |
| `src/lib/logger.ts` | 22.73% | **92.42%** | +69.69 pp | 61 / 5 / 0 |
| `src/lib/job-store/index.ts` | 60.00% | **90.00%** | +30.00 pp | 27 / 3 / 0 |
| `src/lib/job-engine.ts` | 48.18% | **86.35%** | +38.17 pp | 272 / 37 / 6 |
| `src/lib/phone-normalizer.ts` | 44.53% | **86.27%** | +41.74 pp | 88 / 12 / 2 |
| `src/lib/csv-parser.ts` | 33.33% | **69.66%** | +36.33 pp | 124 / 49 / 5 |
| **All 8 files** | **47.33%** | **86.33%** | **+39.00 pp** | **859 / 121 / 15** |

---

## 2. Action & Decision Log (`Practice: Keep a Log`)

| Step | Phase | Commit | Action & Reason | Proof / Verification |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Baseline | `8ac1c5e` | Installed `@vitest/coverage-v8`, `jscpd`, `knip`, and `@stryker-mutator/{core,vitest-runner}@9` (Node 20 compatible); built AST+V8 CRAP tool `scripts/quality/crap_report.mjs`; captured raw BEFORE baseline before editing any product code. | `CRAP >= 10: 22`, `jscpd: 27 clones`, `Stryker: 47.33%`, `V8: 67.61%`. |
| 1 | Phase A (Domain & Types) | `19b1c23` | Replaced flat optional-bag `JobItem`/`PublicJobItem` with a strict discriminated union (`JobItemState`) and branded `E164Phone` parsed once at the input boundary (`parseE164Phone`); deduplicated `Job`/`PublicJobView` shared fields (`JobBaseMetadata`); simplified `sanitizeCsvCell` (CC 15 → 4) and `normalizePhone` (`CRAP < 10`); unified `applyBatchOutcomes` across `job-engine.ts` and `worker/mtproto.ts`. | `tsc --noEmit` rejected unbranded `string` and invalid `checkedAt` access on `pending` items; `pnpm run check` + `eval:domain` passed. |
| 2 | Phase B (Dedup / Dryer) | `d515a68` | Eliminated 7-way API route boilerplate via `src/lib/api-helpers.ts` (`withAuthorizedJob`, `parseJsonBody`, `cooldownErrorResponse`, `storageUnconfiguredResponse`); unified `/start` & `/resume` cooldown enforcement in `transitionJobToActive`; deduplicated `FileJobStore` & `UpstashRedisJobStore` TTL/metrics/active-job predicates; shared `tests/helpers/cp1251.ts` across unit/eval/e2e; excluded temp folders (`.stryker-tmp`, `coverage`, `reports`) from ESLint. | `jscpd` dropped from **27 clones (317 lines)** to 4 clones (41 lines); `pnpm run check` + `eval:domain` passed. |
| 3 | Phase C (Complexity / Crapper) | `06765db` | Extracted pure testable `worker/live-processor.ts` (`processNextLiveBatch`, `computeNextPollDelayMs`, `readWorkerEnvConfig`) and `worker/gramjs-adapter.ts` from monolithic 293-line `worker/mtproto.ts` (CRAP **930** → **<= 6**); split `src/lib/job-store/helpers.ts` out of `types.ts`; unified `/start` & `/resume` via `createActivationHandler`; split `extractExportFields`, `resolveSingleContact`, `baseHealthFields`, and extracted `src/hooks/useTgNaydiJob.ts` from 455-line `TgNaydiWorkspace.tsx`; added full behavioral contract tests for `UpstashRedisJobStore` (Lua compare-and-delete, 24h TTL, FIFO) and live worker (session-wide `FLOOD_WAIT`, concurrent DELETE anti-PII-resurrection, concurrent PAUSE, unrecoverable `failed`); removed unused internal `export`s. | **`CRAP >= 10: 0`** (`exit 0`), **`jscpd: 0 clones (0.00%)`** (`exit 0`), **`knip: 0 dead code`** (`exit 0`), 39/39 tests pass. |
| 4 | Phase D (Mutator & Subtract) | *(final commit)* | Subtracted redundant hand-rolled code flagged by surviving mutants (`toParseCandidate` in `phone-normalizer.ts` already handled natively by `libphonenumber-js`; manual UTF-8 BOM slice in `csv-parser.ts` already stripped natively by `TextDecoder`; duplicated cookie option literals in `auth.ts`); added 14 behavioral mutant-killer tests in `domain-invariants.test.ts`, `phone-normalizer.test.ts`, `csv-io.test.ts`, `providers.test.ts`, and `api-flow.test.ts`; set `stryker.config.mjs` `thresholds.break: 85`. | **StrykerJS: 86.33% (+39.00 pp)**; **V8: 90.30% Stmts / 91.07% Branch**; **CRAP >= 10: 0**; **jscpd: 0 clones**; **knip: 0**; **53/53 tests + 15/15 evals + 14/14 guards + `next build` + 2/2 Playwright E2E all exit `0`**. |
