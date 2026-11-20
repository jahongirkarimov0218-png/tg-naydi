---
name: csv-pii-safety
owner: TG Naydi Engineering / Security Lead
source_policy: docs/sdlc/spec.md (§2 C5, §3.1, §3.4) & REVIEW.md
description: >
  Enforces PII protection, Windows-1251/UTF-8 BOM CSV handling, phone masking,
  and CSV formula-injection neutralization whenever touching CSV import/export,
  phone normalization, API responses, or server logging in TG Naydi.
  USE WHEN: editing CSV parsing, Excel export, phone number formatting, logging,
  job API serialization, or troubleshooting broken Russian characters / PII exposure.
---

# CSV & PII Safety Skill

## Trigger Conditions
Activate this skill for any task involving:
- Uploading, parsing, normalizing, or exporting `.csv` / `.txt` contact lists.
- Displaying phone numbers in UI or returning job items from API endpoints.
- Adding or modifying log statements, error handlers, or export spreadsheets.
- Fixing Russian Excel encoding bugs (mojibake / `windows-1251` / `;` delimiter) or spreadsheet security issues.

## Mandatory Procedure

1. **Decoding Russian Excel Uploads**
   - Attempt strict UTF-8 decode (`new TextDecoder('utf-8', { fatal: true })`); on failure fall back cleanly to `new TextDecoder('windows-1251')`.
   - Auto-detect delimiter (`,`, `;`, `\t`) via `papaparse`.
   - Strip invisible copy-paste artifacts (`\u00A0`, `\u200B`, `\uFEFF`) before calling `libphonenumber-js`.

2. **PII Redaction & Masking**
   - Never pass raw phone numbers (`+7...`, `+998...`, 10+ digit sequences) or Telegram session strings to `console.log`/`console.error`; always use `src/lib/logger.ts` (`redactSensitiveText`).
   - `GET /api/jobs/[id]` and all UI tables MUST return and render ONLY `maskPhone(e164)` (e.g. `+7 905 •••-45-67`). Raw E.164 phones are allowed exclusively in authenticated `GET /api/jobs/[id]/export`.

3. **Safe Excel Export (`result.csv`)**
   - Prepend UTF-8 BOM (`\uFEFF`) so Windows Microsoft Excel renders Cyrillic labels (`человек`, `канал`, `не найден / скрыт`) without mojibake.
   - Neutralize CSV formula injection (`=`, `\t`, `\r`, or formula expressions like `+cmd|...`, `-2+3`, `@SUM(...)`) by prefixing `'`, while preserving valid E.164 phones (`^\+\d{7,15}$`) and valid Telegram handles (`^@[a-zA-Z0-9_]{3,32}$`).
   - Always include the `mode` column (`SANDBOX` or `LIVE_MTPROTO`) so exported data cannot misrepresent sandbox results as live Telegram lookups.

4. **Verification Before Finishing**
   - Run `pnpm run check` and confirm tests covering Windows-1251 decoding, formula sanitization, UTF-8 BOM export, and PII log redaction all pass with exit code `0`.
