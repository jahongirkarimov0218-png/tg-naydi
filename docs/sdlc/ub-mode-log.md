# `ub-mode` Engineering Quality Audit & Fix Log — TG Naydi

**Branch:** `feat/tgn-001-mvp` (worktree `d:\tg naydi\.worktrees\feat-tgn-001-mvp`)
**Baseline Commit SHA:** `b4aa623`
**Date:** 2026-11-20

---

## 1. Raw Baseline Metrics (BEFORE `ub-mode` — measured on commit `b4aa623`)

| Sensor / Tool | Raw Baseline (BEFORE) | Target (AFTER) |
| :--- | :--- | :--- |
| **V8 Coverage (`src/lib`, `src/app/api`, `worker`)** | **67.61% Stmts / 68.20% Branch** (`worker/mtproto.ts`: 0%, `upstash-store.ts`: 0%) | `>= 90%` Stmts & Branch |
| **CRAP Score (`scripts/quality/crap_report.mjs`)** | **22 functions >= 10** (worst: `worker/mtproto.ts:main` = **930**, `importContacts` = **72**, `job-engine.ts:runSandboxJobStep` = **60.15**, `upstash-store.ts:listActiveLiveJobs` = **56**) | **0 functions >= 10** (`exit 0`) |
| **Structural Duplication (`jscpd --min-tokens 35`)** | **27 clones** (317 duplicated lines, 5.75% total / 7.81% TS across `src`, `worker`, `tests`, `evals`) | **0 clones** in `src` & `worker` (business logic) |
| **Dead Code (`knip`)** | **10 unused exports**, **1 unused type (`JobStatus`)**, 2 unreferenced script files | **0 unused exports / dead code** in `src/` & `worker/` |
| **StrykerJS Mutation Score (8 `src/lib` files, 1,143 mutants)** | **47.33% total** (541 killed, 425 survived, 177 no-cov) | **`>= 85%` total** & **0 survivors** in critical invariants |

### Baseline Mutation Score Breakdown (`reports/mutation/mutation.json`)

| File | Baseline Mutation % | Killed | Survived | No Coverage |
| :--- | :---: | :---: | :---: | :---: |
| `src/lib/logger.ts` | 22.73% | 15 | 39 | 12 |
| `src/lib/csv-parser.ts` | 33.33% | 72 | 106 | 38 |
| `src/lib/phone-normalizer.ts` | 44.53% | 61 | 63 | 13 |
| `src/lib/job-engine.ts` | 48.18% | 159 | 101 | 70 |
| `src/lib/auth.ts` | 57.14% | 56 | 35 | 7 |
| `src/lib/csv-exporter.ts` | 59.26% | 96 | 51 | 15 |
| `src/lib/job-store/index.ts` | 60.00% | 18 | 7 | 5 |
| `src/lib/providers/mtproto.ts` | 61.54% | 64 | 23 | 17 |
| **All 8 files** | **47.33%** | **541** | **425** | **177** |

---

## 2. Action & Decision Log (`Practice: Keep a Log`)

| Step | Phase | Action & Reason | Proof / Evidence |
| :--- | :--- | :--- | :--- |
| 0 | Baseline | Installed `@vitest/coverage-v8`, `jscpd`, `knip`, `@stryker-mutator/core@9` + `@stryker-mutator/vitest-runner@9` (Node 20 compatible), built AST+V8 CRAP tool `scripts/quality/crap_report.mjs`, captured raw metrics above before editing any product code. | Raw reports recorded above (`CRAP >= 10: 22`, `jscpd: 27`, `Stryker: 47.33%`). |
