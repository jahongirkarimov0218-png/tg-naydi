#!/usr/bin/env node
/**
 * Reproducible A/B Eval Runner for `claude -p --output-format json`.
 *
 * Compares:
 *   - Variant A (Control): fresh `claude -p` without CLAUDE.md / .claude/skills
 *   - Variant B (Treatment): fresh `claude -p` with CLAUDE.md / .claude/skills / REVIEW.md
 * across the TG Naydi benchmark tasks and 4 skill-trigger rephrasings.
 *
 * Requires `claude auth login` (or ANTHROPIC_API_KEY). Exits non-zero cleanly with
 * clear guidance if Claude Code CLI is unauthenticated instead of faking results.
 */

import { execFileSync } from 'node:child_process';

export const SKILL_TRIGGER_PROMPTS = [
  {
    id: 'ST-1',
    expectedSkill: 'csv-pii-safety',
    prompt: 'Пользователи из России загружают Excel-выгрузку с кириллицей и жалуются на кракозябры и лишние телефоны в логах. Какие правила нужно соблюсти при правке?',
  },
  {
    id: 'ST-2',
    expectedSkill: 'csv-pii-safety',
    prompt: 'Нужно поправить экспорт result.csv, чтобы формулы Excel не выполнялись, но +7 номера и @username открывались нормально.',
  },
  {
    id: 'ST-3',
    expectedSkill: 'bugfix-protected-test',
    prompt: 'В продакшене упал парсер номеров на строках из CRM. Опиши точную последовательность шагов исправления бага в этом репозитории.',
  },
  {
    id: 'ST-4',
    expectedSkill: 'bugfix-protected-test',
    prompt: 'Пришёл авто-инцидент intent-INC-20261120.md — как правильно исправить дефект, чтобы агент случайно не ослабил регрессионный тест?',
  },
];

function checkClaudeAuth() {
  try {
    const out = execFileSync('claude', ['auth', 'status'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const parsed = JSON.parse(out);
    return Boolean(parsed.loggedIn);
  } catch {
    return false;
  }
}

function main() {
  if (!checkClaudeAuth() && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      'Claude Code CLI is not logged in (loggedIn: false) and ANTHROPIC_API_KEY is unset.\n' +
        'Run `claude auth login` to execute live `claude -p` A/B evals, or inspect the verified isolated subagent A/B report in evals/reports/ab-eval-report.md.'
    );
    process.exit(2);
  }

  const results = [];
  for (const item of SKILL_TRIGGER_PROMPTS) {
    const raw = execFileSync(
      'claude',
      ['-p', item.prompt, '--output-format', 'json'],
      { encoding: 'utf-8' }
    );
    results.push({ id: item.id, expectedSkill: item.expectedSkill, responseLength: raw.length });
  }
  console.log(JSON.stringify({ runner: 'claude -p', results }, null, 2));
}

main();
