#!/usr/bin/env node
/**
 * Deterministic Maintain-Loop Anomaly Detector (Stage 06 / Playbook Step 11).
 *
 * Evaluates rolling /api/health probes across three deterministic severity bands:
 *   - Level 0 (normal): healthy within 1 sigma and SLO
 *   - Level 1 (>= 1σ): record observation to history log
 *   - Level 2 (>= 2σ): emit read-only diagnostic summary
 *   - Level 3 (>= 3σ OR hard SLO breach: errorRate > 5% OR status !== 'ok'):
 *       automatically generate docs/sdlc/incidents/intent-INC-<timestamp>.md
 *       closing the Maintain -> Plan loop.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HARD_SLO_ERROR_RATE = 0.05;

export function computeMeanAndStdDev(values) {
  if (!values || values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Pure deterministic classifier for a new health probe against rolling baseline history.
 * @param {Array<{ errorRate: number, latencyMs: number, status: string, timestamp: string }>} history
 * @param {{ errorRate: number, latencyMs: number, status: string, storageMode?: string, providerMode?: string, commitSha?: string, timestamp?: string }} sample
 */
export function evaluateHealthAnomaly(history, sample) {
  const baselineErrorRates = history.map((h) => Number(h.errorRate ?? 0));
  const baselineLatencies = history.map((h) => Number(h.latencyMs ?? 0));

  const errStats = computeMeanAndStdDev(baselineErrorRates);
  const latStats = computeMeanAndStdDev(baselineLatencies);

  // Use a small floor epsilon for stdDev so a completely flat 0% baseline detects sudden spikes cleanly
  const errSigma =
    baselineErrorRates.length >= 3
      ? (sample.errorRate - errStats.mean) / Math.max(errStats.stdDev, 0.005)
      : 0;
  const latSigma =
    baselineLatencies.length >= 3
      ? (sample.latencyMs - latStats.mean) / Math.max(latStats.stdDev, 25)
      : 0;

  const maxSigma = Math.max(errSigma, latSigma);
  const hardSloBreach =
    sample.status !== 'ok' ||
    sample.storageMode === 'unconfigured' ||
    sample.errorRate > HARD_SLO_ERROR_RATE;

  let level = 0;
  let action = 'none';
  const reasons = [];

  if (sample.status !== 'ok') {
    reasons.push(`Health status degraded: ${sample.status}`);
  }
  if (sample.storageMode === 'unconfigured') {
    reasons.push('Vercel storage unconfigured (fail-closed mode)');
  }
  if (sample.errorRate > HARD_SLO_ERROR_RATE) {
    reasons.push(
      `Job errorRate ${(sample.errorRate * 100).toFixed(2)}% exceeds hard SLO ${(HARD_SLO_ERROR_RATE * 100).toFixed(0)}%`
    );
  }
  if (errSigma >= 1) {
    reasons.push(
      `errorRate deviation ${errSigma.toFixed(2)}σ above rolling baseline mean ${(errStats.mean * 100).toFixed(2)}%`
    );
  }
  if (latSigma >= 1) {
    reasons.push(
      `latencyMs deviation ${latSigma.toFixed(2)}σ (${sample.latencyMs}ms vs mean ${latStats.mean.toFixed(1)}ms)`
    );
  }

  if (hardSloBreach || maxSigma >= 3) {
    level = 3;
    action = 'create_incident_intent';
  } else if (maxSigma >= 2) {
    level = 2;
    action = 'read_only_diagnosis';
  } else if (maxSigma >= 1) {
    level = 1;
    action = 'record_observation';
  }

  return {
    level,
    action,
    errSigma: Number(errSigma.toFixed(2)),
    latSigma: Number(latSigma.toFixed(2)),
    maxSigma: Number(maxSigma.toFixed(2)),
    hardSloBreach,
    reasons,
    baselineCount: history.length,
  };
}

export function renderIncidentIntentMarkdown(incidentId, sample, evaluation) {
  const ts = sample.timestamp || new Date().toISOString();
  const evidenceLines = evaluation.reasons.map((r) => `- ${r}`).join('\n');

  return `# Автоматическая постановка по инциденту (${incidentId})

**Источник:** Детерминированный детектор аномалий (\`scripts/monitoring/anomaly_detector.mjs\`)
**Время обнаружения:** ${ts}
**Уровень отклонения:** Level ${evaluation.level} (${evaluation.maxSigma}σ / Hard SLO breach: ${evaluation.hardSloBreach ? 'YES' : 'NO'})
**Статус:** Требует разбора владельцем сервиса (исправить / запланировать / отклонить с причиной)

---

## 1. Проблема и доказательства из мониторинга

${evidenceLines || '- Обнаружено критическое отклонение метрик /api/health.'}

- **Commit SHA на проде:** \`${sample.commitSha || 'unknown'}\`
- **Статус /api/health:** \`${sample.status}\`
- **Provider / Storage:** \`${sample.providerMode || 'unknown'}\` / \`${sample.storageMode || 'unknown'}\`
- **Текущий errorRate:** ${(sample.errorRate * 100).toFixed(2)}% (базовых точек: ${evaluation.baselineCount})
- **Задержка ответа /api/health:** ${sample.latencyMs} ms

---

## 2. Затронутые системы

- Веб-приложение TG Naydi (\`src/app/api/health/route.ts\`, \`src/lib/job-engine.ts\`)
- Хранилище задач (\`src/lib/job-store/\`, режим \`${sample.storageMode || 'unknown'}\`)
- Провайдер проверки (\`src/lib/providers/\`, режим \`${sample.providerMode || 'unknown'}\`)

---

## 3. Предлагаемый результат

1. Воспроизвести причину деградации падающим тестом (заблокированным через \`.claude/state/protected-tests.json\`).
2. При необходимости выполнить немедленный откат на Vercel (\`pnpm dlx vercel rollback\`).
3. Исправить первопричину через PR с прохождением \`pnpm run check\` и \`pnpm run eval:domain\`.
4. Добавить кейс инцидента в \`evals/domain-eval.test.ts\` как постоянный регрессионный случай.

---

## 4. Открытые вопросы для дежурного / владельца продукта

- Подтверждается ли деградация на пользовательских сценариях, или пороги детектора требуют калибровки?
- Нужен ли немедленный \`vercel rollback\` до разбора первопричины?
`;
}

export async function runAnomalyCheck({
  sample,
  historyPath,
  incidentDir,
}) {
  let history = [];
  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    history = [];
  }

  const evaluation = evaluateHealthAnomaly(history, sample);
  const updatedHistory = [...history, sample].slice(-50);

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(updatedHistory, null, 2), 'utf-8');

  let incidentFilePath = null;
  if (evaluation.level === 3) {
    const compactTs = (sample.timestamp || new Date().toISOString())
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const incidentId = `INC-${compactTs}`;
    await fs.mkdir(incidentDir, { recursive: true });
    incidentFilePath = path.join(incidentDir, `intent-${incidentId}.md`);
    const content = renderIncidentIntentMarkdown(incidentId, sample, evaluation);
    await fs.writeFile(incidentFilePath, content, 'utf-8');
  }

  return { evaluation, incidentFilePath };
}

async function runCli() {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const url = getArg('--url', process.env.PRODUCTION_HEALTH_URL || '');
  const historyPath = getArg('--history', 'docs/sdlc/monitoring/history.json');
  const incidentDir = getArg('--incident-dir', 'docs/sdlc/incidents');

  if (!url) {
    console.error('Usage: node scripts/monitoring/anomaly_detector.mjs --url <health_url>');
    process.exit(1);
  }

  const startedAt = Date.now();
  let sample;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - startedAt;
    const body = await res.json().catch(() => ({}));
    sample = {
      timestamp: new Date().toISOString(),
      status: res.ok && body.status === 'ok' ? 'ok' : body.status || `http_${res.status}`,
      errorRate: Number(body?.metrics?.errorRate ?? (res.ok ? 0 : 1)),
      latencyMs,
      storageMode: body?.storageMode || 'unknown',
      providerMode: body?.providerMode || 'unknown',
      commitSha: body?.commitSha || 'unknown',
    };
  } catch (err) {
    sample = {
      timestamp: new Date().toISOString(),
      status: 'unreachable',
      errorRate: 1,
      latencyMs: Date.now() - startedAt,
      storageMode: 'unknown',
      providerMode: 'unknown',
      commitSha: 'unknown',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const result = await runAnomalyCheck({ sample, historyPath, incidentDir });
  console.log(JSON.stringify({ sample, ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runCli();
}
