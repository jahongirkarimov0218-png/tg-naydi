# CLAUDE.md — TG Naydi Engineering Context

Keep this file short, accurate, and executable. Any mistake repeated twice becomes a concrete rule here.

## Commands (strictly `pnpm` — `npm`/`npx` are NOT installed on this host)

- Install deps: `pnpm install`
- Full local check (typecheck + lint + unit/integration tests): `pnpm run check`
- Domain eval suite (15 real cases): `pnpm run eval:domain`
- Browser E2E suite (Playwright): `pnpm run test:e2e`
- Production build: `pnpm run build`
- Adversarial hook/barrier self-test: `python scripts/verify_guards.py`
- Standalone MTProto worker (live mode only): `pnpm run worker:mtproto`

Success means exit code `0` with actual command output attached — never claim passing without running the command.

## Architecture & Source of Truth

- Single source of truth: Git (`docs/sdlc/intent.md`, `docs/sdlc/spec.md`, `docs/sdlc/plan.md`, `docs/decisions/001-architecture.md`).
- Visual references: `docs/design/ref-01-flow-and-usecases.jpg` and `docs/design/ref-02-monitor-and-results.jpg`.
- Next.js App Router (`src/app/`) hosts UI + thin API routes. **NEVER import `telegram` (GramJS) anywhere in `src/app/`** — live MTProto runs strictly in `worker/mtproto.ts`.
- Pluggable storage (`src/lib/job-store/`): `UpstashRedisJobStore` on Vercel (24h TTL), `FileJobStore` locally/CI, fail-closed `503 STORAGE_NOT_CONFIGURED` on Vercel if Upstash vars are unset.
- Pluggable lookup (`src/lib/providers/`): `SandboxLookupProvider` (step-driven via `/api/jobs/[id]/step`) and `MtprotoLookupProvider` (GramJS, standalone worker with global FIFO mutex, `OPERATOR_ACCESS_KEY`, and `pauseMs >= 15000`).

## Non-Negotiable Rules & Known Traps

1. **Zero PII leakage:** NEVER log raw phone numbers (`+7...`, `+998...`) or Telegram session strings. Always route logs through `src/lib/logger.ts` (`redactSensitiveText`). API `GET /api/jobs/[id]` must return ONLY masked phones (`+7 905 •••-45-67`).
2. **Honest Telegram semantics:** Never invent a distinction between unregistered and privacy-hidden numbers — use `not_found_or_hidden`. Classify `channel` strictly via `userFull.personal_channel_id`. Keep counter invariant `foundWithUsername === personWithUsername + channelWithUsername + botWithUsername`.
3. **Excel CSV safety:** Always decode `windows-1251` fallback on upload, export with UTF-8 BOM (`\uFEFF`), neutralize formula injection (`=`, `\t`, `\r`, formulas) while keeping valid E.164 `+7...` and `@username` clean, and stamp `mode` (`SANDBOX` / `LIVE_MTPROTO`).
4. **Protected-test bugfix discipline:** Reproduce every bug with a failing test FIRST, commit it, lock its path in `.claude/state/protected-tests.json`, and NEVER weaken tests to pass.
5. **Plan sync:** If implementation deviates from `docs/sdlc/plan.md`, update `plan.md` in the same commit.
6. **Technical enforcement:** Critical rules are enforced by `.claude/settings.json` + `scripts/hooks/pre_tool_guard.py` (`exit 2`), GitHub Actions CI + `gitleaks`, and `CODEOWNERS` — not by prose alone.
