# REVIEW.md — Code Review Policy for TG Naydi

Every PR (human or agent-authored) is reviewed through three mandatory passes. The author (including an AI agent) cannot self-approve a merge to `main`.

## Mandatory Review Passes

1. **Correctness & Bugs**
   - State-machine edge cases (`draft → running → paused → rate_limited → completed`), idempotency of `/step`, lease lock race conditions, and `F5` reload recovery from server `JobStore`.
   - Counter reconciliation invariant: `foundWithUsername === personWithUsername + channelWithUsername + botWithUsername`.
   - Honest Telegram contract: `not_found_or_hidden` unified status, `personal_channel_id` channel rule, `contacts.deleteContacts` in `finally`, `FloodWaitError` respected without bypass.
2. **Security & PII**
   - Zero secrets, `.env*`, or `*.session` files committed or logged.
   - Zero raw phone numbers in server logs or `GET /api/jobs/[id]` responses (masked format `+7 905 •••-45-67` only; raw phones strictly in authenticated `/export`).
   - `HttpOnly` job token verification on every job endpoint (`401` on missing/invalid token); `OPERATOR_ACCESS_KEY` enforced in `LIVE_MTPROTO` mode.
   - CSV formula injection neutralized without mangling valid E.164 phones or `@username`.
   - Fail-closed behavior on Vercel when `UPSTASH_REDIS_REST_URL` is absent (`503`, never silent `/tmp`).
3. **Spec & Plan Alignment**
   - Matches `docs/sdlc/intent.md`, `docs/sdlc/spec.md`, `docs/decisions/001-architecture.md`, and `docs/design/ref-*.jpg`.
   - Any plan deviation is reflected in `docs/sdlc/plan.md` in the same commit.
   - `telegram` (GramJS) is NEVER imported inside `src/app/`.

## Severity & Noise Rules

- **Blocking (Substantive):** Behavioral breakage, PII/secret leak, security bypass, counter mismatch, weakened test, or spec/ADR violation.
- **Minor (Non-blocking):** **Maximum 5 minor comments per review.** Do NOT leave style/formatting nits already enforced by `tsc` / `eslint`.
- **Excluded from manual/AI review:** Lockfiles (`pnpm-lock.yaml`), generated build artifacts (`.next/`), and binary image fixtures.

## Flaky Test Quarantine Separation

- During normal bug fixes, editing locked tests in `.claude/state/protected-tests.json` is strictly forbidden (`exit 2`).
- Quarantining a flaky test is ONLY allowed in a dedicated PR labeled `flaky-quarantine`, citing failure logs and requiring independent human/code-owner approval.
