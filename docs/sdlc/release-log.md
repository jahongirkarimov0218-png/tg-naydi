# Production Release & SRE Verification Log — TG Naydi (`TGN-001`)

- **Date:** 2026-11-20
- **Repository:** https://github.com/jahongirkarimov0218-png/tg-naydi (`public`, Branch Protection enforced on `main`)
- **Production URL:** https://tg-naydi.vercel.app
- **Vercel Project:** `jahongirkarimov0218-png/tg-naydi` (`prj_hFVKXBFkrfkPK6QEFCNIJZP9cCxl`)
- **Redis Store:** Upstash for Redis (`tg-naydi-redis`, free tier, region `fra1`, `autoUpgrade=false`, `eviction=true`) connected via Vercel Marketplace (`KV_REST_API_URL` / `KV_REST_API_TOKEN`)
- **Provider Mode:** `SANDBOX` (Production & Preview)

---

## 1. GitHub PRs, Linux CI (`gitleaks` + `verify`), and Branch Protection

| Artifact | Link / ID | Result |
| :--- | :--- | :--- |
| **PR #1 (MVP + `ub-mode` hardening)** | https://github.com/jahongirkarimov0218-png/tg-naydi/pull/1 | Merged into `main` as `c52cdc1` (head `523c706`) |
| **PR #1 CI Run (`44710047107`)** | `Secret Scan (Gitleaks)` (job `136199141319`, 8s) + `Typecheck, Lint, Unit/Integration, Domain Evals, Guards & Playwright E2E` (job `136199140835`, 1m51s) | **PASS** (0 secret leaks, 53/53 unit+integration, 15/15 domain evals, 14/14 guards, `next build`, 2/2 Playwright E2E) |
| **PR #2 (`KV_REST_API_*` + `prod_smoke.mjs` + `.gitattributes`)** | https://github.com/jahongirkarimov0218-png/tg-naydi/pull/2 | Merged into `main` as `7809e8b` (head `6da02b2`) under active Branch Protection |
| **PR #2 CI Run (`44711418995`)** | `Secret Scan (Gitleaks)` (job `136203780836`, 7s) + `verify` (job `136203780433`, 1m49s) + `Vercel` + `Vercel Preview Comments` | **PASS** (all 4 checks green) |
| **Branch Protection API (`GET /repos/jahongirkarimov0218-png/tg-naydi/branches/main/protection`)** | `enforce_admins: true`, `allow_force_pushes: false`, `allow_deletions: false`, `pr_reviews_enabled: true`, `required_status_checks.strict: true` (`Secret Scan (Gitleaks)` + `Typecheck, Lint, Unit/Integration, Domain Evals, Guards & Playwright E2E`) | **ACTIVE & VERIFIED** |
| **Maintain Loop Arming (`monitoring.yml`)** | GitHub Actions variable `PRODUCTION_HEALTH_URL=https://tg-naydi.vercel.app/api/health` | **CONFIGURED** |

> **Platform note recorded honestly:** GitHub Free returned `HTTP 403 (Upgrade to GitHub Pro or make this repository public to enable this feature)` for both Branch Protection and Repository Rulesets while the repository was private. After `Secret Scan (Gitleaks)` confirmed 0 secrets across Git history, the owner approved switching the repository to `public` so server-side Branch Protection is genuinely enforced.

---

## 2. Vercel Deployments & Rollback Drill (`vercel rollback`)

| Role | Deployment ID | Deployment URL | Commit SHA | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Preview Deploy** | `dpl_BtnCM7TVcobMHFjFEMPcR23tda8c` | https://tg-naydi-qyiven98n-jahongirkarimov0218-png.vercel.app | `6da02b2` | `READY` (`storageMode: "upstash"` verified via `vercel curl`) |
| **Production Deploy #1 (Rollback Target)** | `dpl_34HYDiACUdVQf7y2MPvnUgwc1y8L` | https://tg-naydi-mij41wahj-jahongirkarimov0218-png.vercel.app | `7809e8b` | `READY` — **Active Production Alias** after rollback |
| **Production Deploy #2 (Drill Release)** | `dpl_6Z4tGHaFYx5EH1yaooPsEFAFZ73i` | https://tg-naydi-qysestvwl-jahongirkarimov0218-png.vercel.app | `7809e8b` | `READY` — aliased to `https://tg-naydi.vercel.app`, verified `HTTP 200`, then rolled back |

### Live Rollback Verification
- **Command:** `pnpm dlx vercel rollback dpl_34HYDiACUdVQf7y2MPvnUgwc1y8L --yes --json`
- **Outcome:** `"outcome": "rolled_back"`, exit code `0`, **elapsed time (RTO): `6.62s`**.
- **Alias Proof (`vercel inspect dpl_34HYDiACUdVQf7y2MPvnUgwc1y8L`):** confirmed `https://tg-naydi.vercel.app`, `https://tg-naydi-jahongirkarimov0218-png.vercel.app`, and `https://tg-naydi-git-main-jahongirkarimov0218-png.vercel.app` point back to `dpl_34HYDiACUdVQf7y2MPvnUgwc1y8L`.
- **Immediate Post-Rollback Healthcheck (`GET https://tg-naydi.vercel.app/api/health`):**
  - **HTTP `200`**: `{"version":"0.1.0","commitSha":"7809e8b973792132a7f8a175a29a620742decfa0","providerMode":"SANDBOX","storageMode":"upstash","status":"ok","workerOnline":false,"metrics":{"recentJobsTotal":2,"recentJobsCompleted":2,"recentJobsFailed":0,"recentFloodWaits":0,"errorRate":0}}`

---

## 3. External Live HTTPS Smoke & Security Probe (`scripts/smoke/prod_smoke.mjs`)

Executed against live Production (`https://tg-naydi.vercel.app`, deployment `dpl_34HYDiACUdVQf7y2MPvnUgwc1y8L`, exit `0`):

| # | Endpoint / Probe | HTTP | Verified Assertion |
| :-: | :--- | :-: | :--- |
| 1 | `GET /api/health` | `200` | `status=ok`, `storageMode=upstash`, `providerMode=SANDBOX`, `commitSha=7809e8b` |
| 2 | `POST /api/jobs` | `201` | Draft job created; `Set-Cookie` contains `Secure; HttpOnly; SameSite=lax; Max-Age=86400`; 0 raw E.164 phones in JSON |
| 3 | `GET /api/jobs/:id` (no cookie) | `401` | Unauthorized PII access blocked |
| 4 | `POST /api/jobs/:id/chunks` | `200` | `added=4, total=4`; 0 raw E.164 phones in response |
| 5 | `POST /api/jobs/:id/start` | `200` | `status=running` |
| 6 | `POST /api/jobs/:id/step` (batch 1) | `200` | `processed=2/4`; 0 raw E.164 phones in JSON |
| 7 | `POST /api/jobs/:id/pause` | `200` | `status=paused` |
| 8 | `GET /api/jobs/:id` (F5 reload) | `200` | `status=paused` & `processed=2` persisted in Upstash Redis; 0 raw E.164 phones in JSON |
| 9 | `POST /api/jobs/:id/resume` | `200` | Resumed to `running` |
| 10 | `POST /api/jobs/:id/step` (finish) | `200` | `status=completed`, `processed=4/4` |
| 11 | `GET /api/jobs/:id/export` | `200` | Raw bytes start with UTF-8 BOM `[0xEF, 0xBB, 0xBF]` + Russian Excel `;` header (`495 bytes`) |
| 12 | `DELETE /api/jobs/:id` | `200` | Job & PII deleted immediately |
| 13 | `GET /api/jobs/:id` (post-DELETE) | `404` | Confirmed permanently removed from Upstash Redis |

---

## 4. `LIVE_MTPROTO` Production Cutover & Canary Verification

- **PR #6 (Worker `.env.local` autoload + canary probe):** https://github.com/jahongirkarimov0218-png/tg-naydi/pull/6 (merged into `main` as `6174824`, CI run `44716023181` — `Gitleaks` + `verify` + `Vercel` all PASS)
- **Active `LIVE_MTPROTO` Production Deployment:** `dpl_Gm7KMLRi5nP5xgAKLWYD3cxUaJSe` (`https://tg-naydi.vercel.app`, `PROVIDER_MODE=LIVE_MTPROTO`, `NEXT_PUBLIC_PROVIDER_MODE=LIVE_MTPROTO`, 256-bit `OPERATOR_ACCESS_KEY` stored as Vercel Secret & local `.env.local`)
- **Standalone Worker (`pnpm run worker:mtproto`):** Connected cleanly to Telegram MTProto (`149.154.167.50`, GramJS LAYER 198); **0 raw E.164 phone numbers and 0 `TELEGRAM_SESSION` strings** in worker logs.

### Live Canary Probe (`node scripts/smoke/live_canary.mjs https://tg-naydi.vercel.app`, exit `0`)

| # | Check | HTTP | Verified Result |
| :-: | :--- | :-: | :--- |
| 1 | `GET /api/health` | `200` | `providerMode=LIVE_MTPROTO`, `storageMode=upstash`, **`workerOnline=true`** |
| 2 | `POST /api/jobs` (no operator key) | `401` | Fail-closed operator gate blocked unauthorized caller |
| 3 | `POST /api/auth/operator` | `200` | Issued `tgnaydi_operator` cookie (`Secure; HttpOnly; SameSite=lax; Max-Age=43200`) |
| 4 | `POST /api/jobs` (canary) | `201` | Safety floors enforced (`batchSize=2 <= 5`, `pauseMs=15000 >= 15000`) |
| 5 | `POST /api/jobs/:id/chunks` + `/start` | `200` | `added=2`, transitioned to `queued` for standalone worker |
| 6 | Live worker processing (`Upstash ↔ Telegram MTProto`) | `200` | `status=completed`, `processed=2/2`, `found=2`, **0 raw E.164 phones in JSON** |
| 7 | `GET /api/jobs/:id/export` | `200` | Raw UTF-8 BOM `[0xEF, 0xBB, 0xBF]` + `;LIVE_MTPROTO;` mode marker verified (`274 bytes`) |
| 8 | `DELETE /api/jobs/:id` → `GET /api/jobs/:id` | `200` → `404` | Canary PII removed immediately from Upstash Redis |

### Emergency Kill-Switch (Instant Return to `SANDBOX`)
If the standalone worker is stopped or Telegram issues prolonged `FLOOD_WAIT`, return production to `SANDBOX` immediately:
```powershell
node -e "const {execFileSync}=require('child_process'); for (const k of ['PROVIDER_MODE','NEXT_PUBLIC_PROVIDER_MODE']) execFileSync('pnpm.cmd',['dlx','vercel','env','add',k,'--environment','production','--force','--type','config'],{input:'SANDBOX',stdio:['pipe','inherit','inherit'],shell:true});"
pnpm dlx vercel deploy --prod --yes
```
