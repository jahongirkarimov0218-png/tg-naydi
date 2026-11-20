# TG Naydi (TGN-001) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the **TG Naydi** web platform (CSV phone upload → paused batch Telegram lookup with pause/F5/resume → masked live monitor → Excel-safe `result.csv` export) together with the full AI-native SDLC control plane (hooks, skills, CI, evals, anomaly detector) ready for Vercel deployment and rollback verification.

**Architecture:** Next.js App Router (TypeScript + Tailwind CSS) hosts the UI and thin API routes with zero GramJS bundling. Client-side `papaparse` + `libphonenumber-js` normalizes CSVs and uploads ≤500-phone chunks (~25 KB) to stay far below Vercel's 4.5 MB limit. State persists in a pluggable `JobStore` (`UpstashRedisJobStore` on Vercel with 24h TTL, `FileJobStore` locally/CI, fail-closed `503` if Vercel lacks Upstash). Lookups run behind `TelegramLookupProvider`: `SandboxLookupProvider` executes step-by-step via `/api/jobs/[id]/step`, while `MtprotoLookupProvider` runs exclusively in standalone `worker/mtproto.ts` behind an operator key and global FIFO session mutex.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS v4, `papaparse`, `libphonenumber-js`, `@upstash/redis`, `zod`, `lucide-react`, `telegram` (GramJS — worker/tests only), `vitest`, `@playwright/test`, Python 3.13 (hooks & guard tests), Node.js 20 (`pnpm`).

**Spec:** `docs/sdlc/spec.md` (with `docs/sdlc/intent.md`, `docs/decisions/001-architecture.md`, `docs/sdlc/source-of-truth.md`, `docs/design/ref-01-flow-and-usecases.jpg`, `docs/design/ref-02-monitor-and-results.jpg`).

## Global Constraints

- Package manager is strictly `pnpm` / `pnpm dlx` (`npm`/`npx` are not installed on this Windows host).
- Vercel Serverless request body limit is 4.5 MB: upload chunks MUST be `<= 500` normalized E.164 phones per request; max `10,000` unique phones per job.
- PII safety: never log raw phone numbers or Telegram session strings; mask phones as `+7 905 •••-45-67` in UI and `GET /api/jobs/[id]`; auto-expire jobs after 24h TTL (`86400`s).
- Honest modes & statuses: `SANDBOX` MUST show an unmistakable UI badge and stamp `mode=SANDBOX` in `result.csv`; unregistered and privacy-hidden numbers MUST share one status `not_found_or_hidden`; channel classification uses `userFull.personal_channel_id` strictly (no bio scraping).
- Counter invariant: `stats.foundWithUsername === stats.personWithUsername + stats.channelWithUsername + stats.botWithUsername` at every point in time.
- Live safety: `LIVE_MTPROTO` requires `OPERATOR_ACCESS_KEY`, global session mutex (FIFO, 1 active job), server-enforced `pauseMs >= 15000`, `batchSize <= 15`, and GramJS MUST NOT be imported anywhere inside `src/app/`.
- Windows sandbox honesty: `PreToolUse` hooks enforce `exit 2` locally (including fail-closed when `TGNAYDI_REQUIRE_SANDBOX=1`), and GitHub Actions (`ubuntu-latest`) enforces Linux CI + `gitleaks`.

## Review Focus

1. **Windows-1251 Excel CSV with semicolons, UTF-8/CP1251 BOM, and Excel non-breaking spaces (`\u00A0`) in phone numbers** — must decode Cyrillic headers cleanly and normalize `8\u00A0(905)\u00A0123-45-67` into `+79051234567` without dropping rows (pinned in Task 3 & Task 8).
2. **Double-click / parallel tab calling `POST /api/jobs/[id]/step` simultaneously** — lease lock must prevent double-processing the same batch or corrupting counters (pinned in Task 4 & Task 6).
3. **CSV Formula Injection in exported `result.csv` vs valid `+7...` phones and `@username` handles** — `=HYPERLINK(...)` or `=cmd|'...'` in any field must be neutralized with leading `'`, while valid E.164 `+79051234567` and valid `@beze_cakes_kzn` stay intact (pinned in Task 3).
4. **Page refresh (`F5`) mid-run or while paused / rate-limited on a separate browser request** — server `JobStore` + `HttpOnly` cookie must restore exact status, processed items, and `retryAfterAt` countdown; missing/wrong cookie must return `401` (pinned in Task 6 & Task 10).
5. **Vercel deployment missing `UPSTASH_REDIS_REST_URL`** — must fail closed with `503 STORAGE_NOT_CONFIGURED` on job creation and report `storageMode: 'unconfigured'` in `/api/health` instead of silently using ephemeral `/tmp` (pinned in Task 4 & Task 6).

---

## File Structure

### SDLC Control Plane (committed on `main` before feature branch)
- `CLAUDE.md` — Concise project context, verified `pnpm` commands, architecture, non-negotiables.
- `REVIEW.md` — Code review checklist (bugs, PII/security, spec/plan alignment, max 5 minor comments).
- `.claude/settings.json` — `permissions.deny/ask/allow` and `PreToolUse`/`PostToolUse` hook registrations.
- `.claude/skills/csv-pii-safety/SKILL.md` — Triggered skill for CSV parsing/export and PII protection.
- `.claude/skills/bugfix-protected-test/SKILL.md` — Triggered skill for failing-test-first + hook-locked bugfixes.
- `scripts/hooks/pre_tool_guard.py` — Deterministic `PreToolUse` guard (`exit 2` + audit log `.data/hook-audit.jsonl`).
- `scripts/hooks/post_tool_audit.py` — Deterministic `PostToolUse` audit recorder.
- `scripts/verify_guards.py` — Adversarial red-team test suite proving all 4 blocks (`exit 2`) and allowed ops (`exit 0`).
- `.github/workflows/ci.yml` — Linux CI (`gitleaks`, `pnpm run check`, `pnpm run eval:domain`, Playwright E2E, `verify_guards.py`).
- `.github/workflows/monitoring.yml` — Scheduled probe running `anomaly_detector.mjs` and opening a PR on Level 3.
- `.github/CODEOWNERS` — Mandatory code-owner review rules.
- `.env.example` — Template of environment variables (zero secrets).

### Product Codebase (built inside `.worktrees/feat-tgn-001-mvp`)
- `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`
- `src/lib/types.ts` — Shared domain types (`Job`, `JobItem`, `JobStatus`, `JobStats`, `AccountType`, `LookupOutcome`, `BatchLookupResult`, `ProviderMode`, `StorageMode`).
- `src/lib/logger.ts` — PII-redacting structured logger (`redactSensitiveText`, `logInfo`, `logError`).
- `src/lib/phone-normalizer.ts` — `normalizePhone`, `maskPhone`, `validateAndDedupePhones`.
- `src/lib/csv-parser.ts` — `decodeCsvBytes` (UTF-8 + CP1251), `detectPhoneColumn`, `parseCsvBuffer`.
- `src/lib/csv-exporter.ts` — `sanitizeCsvCell`, `buildResultCsv` (UTF-8 BOM, `;` or `,`, `mode` column).
- `src/lib/sample-data.ts` — Built-in «Контакты Казани.csv» fixture (25 rows -> 22 unique valid -> 19 found: 14 person + 5 channel, 3 `not_found_or_hidden`).
- `src/lib/job-store/types.ts` — `JobStore` interface.
- `src/lib/job-store/file-store.ts` — Atomic JSON `FileJobStore` for local/CI with 24h TTL and lease/mutex lock files.
- `src/lib/job-store/upstash-store.ts` — `UpstashRedisJobStore` via `@upstash/redis` HTTP REST with 24h TTL, atomic `SET NX PX` locks, active live queue, and worker heartbeat.
- `src/lib/job-store/index.ts` — `getJobStore()`, `getStorageMode()` (fail-closed on Vercel without Upstash).
- `src/lib/providers/types.ts` — `TelegramLookupProvider` interface.
- `src/lib/providers/sandbox.ts` — Deterministic `SandboxLookupProvider` (Kazan fixture + hash fallback + `+79990000429` one-shot `FLOOD_WAIT`).
- `src/lib/providers/mtproto.ts` — `MtprotoLookupProvider` (GramJS adapter with `importContacts`, `getFullUser` -> `personalChannelId`, `deleteContacts` in `finally`, `FloodWaitError` mapping; injected client for contract tests).
- `worker/mtproto.ts` — Standalone Node/TSX daemon polling `JobStore` FIFO live queue with global session mutex & 15s heartbeat.
- `src/lib/auth.ts` — `generateJobToken`, `hashToken`, `verifyTokenHash`, cookie helpers, `verifyOperatorAccess`.
- `src/lib/job-engine.ts` — `createDraftJob`, `appendJobChunks`, `startJob`, `stepJob`, `pauseJob`, `resumeJob`, `computeJobStats`, `toPublicJobView`.
- `src/app/api/health/route.ts` — `GET /api/health`.
- `src/app/api/auth/operator/route.ts` — `POST /api/auth/operator`.
- `src/app/api/jobs/route.ts` — `POST /api/jobs`.
- `src/app/api/jobs/[id]/route.ts` — `GET /api/jobs/[id]`, `DELETE /api/jobs/[id]`.
- `src/app/api/jobs/[id]/chunks/route.ts` — `POST /api/jobs/[id]/chunks`.
- `src/app/api/jobs/[id]/start/route.ts` — `POST /api/jobs/[id]/start`.
- `src/app/api/jobs/[id]/step/route.ts` — `POST /api/jobs/[id]/step`.
- `src/app/api/jobs/[id]/pause/route.ts` — `POST /api/jobs/[id]/pause`.
- `src/app/api/jobs/[id]/resume/route.ts` — `POST /api/jobs/[id]/resume`.
- `src/app/api/jobs/[id]/export/route.ts` — `GET /api/jobs/[id]/export`.
- `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- `src/components/ModeBanner.tsx`, `src/components/UploadPanel.tsx`, `src/components/LiveMonitorCard.tsx`, `src/components/ResultsCard.tsx`, `src/components/LandingSections.tsx`, `src/components/TgNaydiWorkspace.tsx`
- `scripts/monitoring/anomaly_detector.mjs` — Deterministic `1σ / 2σ / 3σ` detector generating `docs/sdlc/incidents/intent-INC-*.md`.
- `scripts/evals/run_claude_ab.mjs` — Ready `claude -p --output-format json` A/B runner.
- `evals/domain-eval.test.ts` — 15-case deterministic domain & policy eval suite.
- `evals/reports/ab-eval-report.md` — Verified A/B configuration & skill-trigger eval report.
- `tests/e2e/tg-naydi.spec.ts` — Playwright end-to-end test suite.
- `docs/owner-guide.md` — Plain-Russian operations, rollback, Upstash, and MTProto guide for the non-developer founder.

---

### Task 1: SDLC Governance, Skills, Hooks & CI Scaffolding (on `main`)

**Files:**
- Create: `CLAUDE.md`, `REVIEW.md`, `.claude/settings.json`, `.claude/skills/csv-pii-safety/SKILL.md`, `.claude/skills/bugfix-protected-test/SKILL.md`, `scripts/hooks/pre_tool_guard.py`, `scripts/hooks/post_tool_audit.py`, `scripts/verify_guards.py`, `.github/workflows/ci.yml`, `.github/workflows/monitoring.yml`, `.github/CODEOWNERS`, `.env.example`
- Modify: `.gitignore` (add `.worktrees/`)

**Interfaces:**
- Produces: `scripts/hooks/pre_tool_guard.py` reading Claude Code `PreToolUse` JSON on `stdin` (`{ tool_name, tool_input }`), exiting `2` with reason on `stderr` for forbidden actions and `0` for allowed actions; `.claude/state/protected-tests.json` schema `{ "protectedFiles": string[], "reason": string }`.

- [ ] **Step 1: Update `.gitignore` to ignore `.worktrees/` and create `.env.example`, `CLAUDE.md`, `REVIEW.md`, and both `SKILL.md` files.**
- [ ] **Step 2: Create `.claude/settings.json`, `scripts/hooks/pre_tool_guard.py`, `scripts/hooks/post_tool_audit.py`, and `.github/` workflows + `CODEOWNERS`.**
- [ ] **Step 3: Write adversarial test runner `scripts/verify_guards.py` asserting `exit 2` on (a) `.env` read via `Read` and `Bash`, (b) editing a file in `.claude/state/protected-tests.json`, (c) `git push origin main` and `--force`, (d) `TGNAYDI_REQUIRE_SANDBOX=1` on Windows without Linux sandbox, and `exit 0` on normal file edits + `pnpm run check`.**
- [ ] **Step 4: Run `python scripts/verify_guards.py` and verify 100% pass + audit entries in `.data/hook-audit.jsonl`.**
- [ ] **Step 5: Commit SDLC control plane on `main`.**

---

### Task 2: Isolated Worktree & Next.js / Vitest / Playwright Project Scaffold

**Files:**
- Create (in `.worktrees/feat-tgn-001-mvp`): `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `src/lib/types.ts`

**Interfaces:**
- Produces: `pnpm run check` (`tsc --noEmit && eslint . && vitest run`), `pnpm run eval:domain`, `pnpm run test:e2e`, `pnpm run build`, and shared domain types in `src/lib/types.ts`.

- [ ] **Step 1: Verify `git check-ignore -q .worktrees` and create `.worktrees/feat-tgn-001-mvp` on branch `feat/tgn-001-mvp`.**
- [ ] **Step 2: Write `package.json`, configs, and `src/lib/types.ts`.**
- [ ] **Step 3: Run `pnpm install` and ensure Playwright Chromium binary is available.**
- [ ] **Step 4: Verify `pnpm exec tsc --noEmit` passes with exit 0.**
- [ ] **Step 5: Commit scaffold in worktree.**

---

### Task 3: Phone Normalization, PII Masking, Logger, CSV Parser & Exporter (TDD)

**Files:**
- Create: `src/lib/logger.ts`, `src/lib/phone-normalizer.ts`, `src/lib/csv-parser.ts`, `src/lib/csv-exporter.ts`, `src/lib/sample-data.ts`
- Test: `tests/unit/phone-normalizer.test.ts`, `tests/unit/csv-io.test.ts`

**Interfaces:**
- Consumes: `src/lib/types.ts`
- Produces:
  - `normalizePhone(raw: string, defaultCountry: SupportedCountry): string | null`
  - `maskPhone(e164: string): string` (e.g. `+79051234567` → `+7 905 •••-45-67`)
  - `validateAndDedupePhones(rawValues: string[], defaultCountry: SupportedCountry): PhoneBatchValidation`
  - `decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1251' }`
  - `parseCsvBuffer(bytes: Uint8Array, defaultCountry: SupportedCountry, columnOverride?: string): ParsedCsvResult`
  - `sanitizeCsvCell(value: string): string`
  - `buildResultCsv(job: Job, options: { delimiter: ';' | ','; onlyFound: boolean }): string`
  - `redactSensitiveText(input: string): string`
  - `KAZAN_SAMPLE_CSV_BYTES: Uint8Array` and `KAZAN_FIXTURE_MAP`

- [ ] **Step 1: Write failing unit tests covering Review Focus #1 (Windows-1251, `;`, BOM, `8 905...`, UZ `+998`), Review Focus #3 (formula injection `=cmd` vs valid `+7...`/`@user`), masking, deduplication, and PII log redaction.**
- [ ] **Step 2: Run `pnpm exec vitest run tests/unit/phone-normalizer.test.ts tests/unit/csv-io.test.ts` — verify FAIL.**
- [ ] **Step 3: Implement `logger.ts`, `phone-normalizer.ts`, `csv-parser.ts`, `csv-exporter.ts`, `sample-data.ts`.**
- [ ] **Step 4: Re-run vitest — verify PASS.**
- [ ] **Step 5: Commit.**

---

### Task 4: JobStore (`FileJobStore`, `UpstashRedisJobStore`, Fail-Closed Guard) (TDD)

**Files:**
- Create: `src/lib/job-store/types.ts`, `src/lib/job-store/file-store.ts`, `src/lib/job-store/upstash-store.ts`, `src/lib/job-store/index.ts`
- Test: `tests/unit/job-store.test.ts`

**Interfaces:**
- Consumes: `src/lib/types.ts`
- Produces: `JobStore` interface, `FileJobStore`, `UpstashRedisJobStore`, `getJobStore(): JobStore | null`, `getStorageMode(): StorageMode` (`'upstash' | 'file' | 'unconfigured'`).

- [ ] **Step 1: Write failing unit tests for CRUD, token hash verification, lease mutex (Review Focus #2), global MTProto session lock, FIFO live queue, heartbeat, 24h TTL expiry, and Vercel fail-closed `storageMode === 'unconfigured'` (Review Focus #5).**
- [ ] **Step 2: Run vitest — verify FAIL.**
- [ ] **Step 3: Implement `types.ts`, `file-store.ts`, `upstash-store.ts`, `index.ts`.**
- [ ] **Step 4: Run vitest — verify PASS.**
- [ ] **Step 5: Commit.**

---

### Task 5: Lookup Providers (`SandboxLookupProvider`, `MtprotoLookupProvider`, `worker/mtproto.ts`) (TDD)

**Files:**
- Create: `src/lib/providers/types.ts`, `src/lib/providers/sandbox.ts`, `src/lib/providers/mtproto.ts`, `worker/mtproto.ts`
- Test: `tests/unit/providers.test.ts`

**Interfaces:**
- Consumes: `src/lib/types.ts`, `src/lib/sample-data.ts`, `src/lib/job-store/types.ts`
- Produces: `TelegramLookupProvider`, `SandboxLookupProvider`, `MtprotoLookupProvider` (accepting injected `MtprotoClientLike` for deterministic contract tests), `classifyResolvedUser(...)`, and standalone `worker/mtproto.ts`.

- [ ] **Step 1: Write failing unit/contract tests covering Kazan fixture reconciliation (`19 = 14 + 5` + `3 not_found_or_hidden`), `+79990000429` one-shot `FLOOD_WAIT`, GramJS `importContacts` + `getFullUser` (`personalChannelId`) + `bot` + `found_no_username` + `not_found_or_hidden` + `FloodWaitError` + guaranteed `deleteContacts` in `finally`.**
- [ ] **Step 2: Run vitest — verify FAIL.**
- [ ] **Step 3: Implement `types.ts`, `sandbox.ts`, `mtproto.ts`, `worker/mtproto.ts`. Verify GramJS is never imported from `src/app/`.**
- [ ] **Step 4: Run vitest — verify PASS.**
- [ ] **Step 5: Commit.**

---

### Task 6: Auth, Job Engine & Next.js API Routes (TDD)

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/job-engine.ts`, `src/app/api/health/route.ts`, `src/app/api/auth/operator/route.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/[id]/chunks/route.ts`, `src/app/api/jobs/[id]/start/route.ts`, `src/app/api/jobs/[id]/step/route.ts`, `src/app/api/jobs/[id]/pause/route.ts`, `src/app/api/jobs/[id]/resume/route.ts`, `src/app/api/jobs/[id]/export/route.ts`
- Test: `tests/integration/api-flow.test.ts`

**Interfaces:**
- Consumes: `src/lib/job-store`, `src/lib/providers/sandbox`, `src/lib/csv-exporter`, `src/lib/phone-normalizer`, `src/lib/logger`
- Produces: All HTTP routes in `spec.md` §1 and `job-engine.ts` pure/store-backed operations.

- [ ] **Step 1: Write failing integration tests covering full lifecycle (create → chunks → start → step → pause → reload GET with cookie → resume → complete → export → delete), `401` without cookie, `429` during `FLOOD_WAIT`, concurrent step lease safety, `LIVE_MTPROTO` operator gate + `pauseMs >= 15000` floor + `202 delegatedToWorker`, Vercel `503 STORAGE_NOT_CONFIGURED`, and masked-only phones in `GET`.**
- [ ] **Step 2: Run vitest — verify FAIL.**
- [ ] **Step 3: Implement `auth.ts`, `job-engine.ts`, and all API route handlers.**
- [ ] **Step 4: Run vitest — verify PASS.**
- [ ] **Step 5: Commit.**

---

### Task 7: Web UI Faithful to `ref-01` & `ref-02` Screenshots

**Files:**
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/components/ModeBanner.tsx`, `src/components/UploadPanel.tsx`, `src/components/LiveMonitorCard.tsx`, `src/components/ResultsCard.tsx`, `src/components/LandingSections.tsx`, `src/components/TgNaydiWorkspace.tsx`

**Interfaces:**
- Consumes: `src/lib/csv-parser.ts` (client-side parse/chunk), API routes `/api/*`, `src/lib/sample-data.ts`.
- Produces: Full responsive Russian SaaS UI matching `docs/design/ref-01-flow-and-usecases.jpg` & `ref-02-monitor-and-results.jpg` with live `SANDBOX`/`LIVE` badge, operator unlock dialog (in live mode), drag-and-drop CSV, Kazan 1-click sample, dark live monitor, progress/summary counters, filterable `@username` tags, Excel CSV download, and `F5` URL+server recovery.

- [ ] **Step 1: Implement layout, Tailwind v4 styling, Inter + JetBrains Mono fonts, and modular components.**
- [ ] **Step 2: Run `pnpm run check` and `pnpm run build` — verify zero TypeScript, ESLint, or Next.js build errors.**
- [ ] **Step 3: Commit.**

---

### Task 8: Protected-Test Bugfix Cycle Proof (Stage 08 Playbook)

**Files:**
- Modify: `tests/unit/phone-normalizer.test.ts`, `src/lib/phone-normalizer.ts`
- Temporary state: `.claude/state/protected-tests.json`

- [ ] **Step 1: Write a failing regression test for Excel copy-paste phones containing non-breaking spaces (`\u00A0`), zero-width chars (`\u200B`/`\uFEFF`), and messy Russian formatting (`+7\u00A0(905)\u00A0123-45-67`, `8\u00A0905\u00A0123\u00A045\u00A067`).**
- [ ] **Step 2: Run vitest — confirm FAIL. Commit failing test alone (`test: reproduce NBSP/ZWSP phone parsing bug`).**
- [ ] **Step 3: Lock `tests/unit/phone-normalizer.test.ts` in `.claude/state/protected-tests.json` and run `pre_tool_guard.py` against a simulated edit to that test — confirm `exit 2` block!**
- [ ] **Step 4: Fix `src/lib/phone-normalizer.ts` without touching the test, run vitest — confirm PASS.**
- [ ] **Step 5: Clear `.claude/state/protected-tests.json` and commit fix (`fix: strip NBSP and zero-width characters during phone normalization`).**

---

### Task 9: Deterministic Anomaly Detector, 15-Case Domain Evals & Non-Developer Owner Guide

**Files:**
- Create: `scripts/monitoring/anomaly_detector.mjs`, `tests/unit/anomaly-detector.test.ts`, `evals/domain-eval.test.ts`, `scripts/evals/run_claude_ab.mjs`, `docs/owner-guide.md`

- [ ] **Step 1: Write failing unit tests for `anomaly_detector.mjs` (`normal`, `1σ` log, `2σ` diagnostic, `3σ` / `errorRate > 5%` generating `intent-INC-*.md` with required sections).**
- [ ] **Step 2: Implement `scripts/monitoring/anomaly_detector.mjs` and verify tests PASS.**
- [ ] **Step 3: Write `evals/domain-eval.test.ts` (15 real domain/policy cases) and `scripts/evals/run_claude_ab.mjs`, run `pnpm run eval:domain` — verify 15/15 PASS.**
- [ ] **Step 4: Write `docs/owner-guide.md` in plain Russian (verification checklist, Vercel rollback in 1 click/command, Upstash setup, live MTProto worker activation).**
- [ ] **Step 5: Commit.**

---

### Task 10: Playwright E2E, Visual Verification, Blind Review & A/B Agent Eval

**Files:**
- Create: `tests/e2e/tg-naydi.spec.ts`, `evals/reports/ab-eval-report.md`

- [ ] **Step 1: Write Playwright E2E test covering: dirty Windows-1251 `;` CSV upload (duplicates + invalid + mixed formats) → Start → Pause → `page.reload()` (`F5`) → assert persisted paused progress → Resume → Completed → assert reconciled counters & masked phones → download `result.csv` & assert UTF-8 BOM, `;` columns, `mode=SANDBOX`, no formula injection → Delete job → assert 404/cleared UI + capture desktop screenshot.**
- [ ] **Step 2: Run `pnpm run test:e2e`, `pnpm run check`, `pnpm run eval:domain`, `python scripts/verify_guards.py`, and `pnpm run build` — verify ALL exit 0. Visually inspect the Playwright screenshot against `docs/design/ref-01` & `ref-02`.**
- [ ] **Step 3: Dispatch fresh Blind Handoff Reviewer subagent (no chat history) to review the full branch against `REVIEW.md`, `intent.md`, `spec.md`, `plan.md`, and `001-architecture.md`. Fix any real findings and re-run all checks.**
- [ ] **Step 4: Execute real isolated A/B Agent Eval (Variant A without `CLAUDE.md`/skills vs Variant B with `CLAUDE.md`/skills + 4 skill-trigger rephrasings), grade deterministically, and commit reproducible report in `evals/reports/ab-eval-report.md`.**
- [ ] **Step 5: Merge verified `feat/tgn-001-mvp` into `main` (or prepare PR for GitHub) and proceed to Checkpoint 2 (GitHub/Vercel live deploy & rollback drill).**
