import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateHealthAnomaly,
  runAnomalyCheck,
} from '../../scripts/monitoring/anomaly_detector.mjs';

const STABLE_HISTORY = [
  { timestamp: '2026-11-20T01:00:00Z', status: 'ok', errorRate: 0.01, latencyMs: 100 },
  { timestamp: '2026-11-20T01:30:00Z', status: 'ok', errorRate: 0.012, latencyMs: 110 },
  { timestamp: '2026-11-20T02:00:00Z', status: 'ok', errorRate: 0.009, latencyMs: 95 },
  { timestamp: '2026-11-20T02:30:00Z', status: 'ok', errorRate: 0.011, latencyMs: 105 },
  { timestamp: '2026-11-20T03:00:00Z', status: 'ok', errorRate: 0.01, latencyMs: 100 },
];

describe('Deterministic Anomaly Detector (Maintain -> Plan loop)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies normal, 1-sigma observation, 2-sigma diagnostic, and 3-sigma / hard SLO breach cleanly', () => {
    const normal = evaluateHealthAnomaly(STABLE_HISTORY, {
      status: 'ok',
      errorRate: 0.01,
      latencyMs: 102,
    });
    expect(normal.level).toBe(0);
    expect(normal.action).toBe('none');

    const level1 = evaluateHealthAnomaly(STABLE_HISTORY, {
      status: 'ok',
      errorRate: 0.017, // ~1.3σ above 0.0104 with 0.005 floor
      latencyMs: 105,
    });
    expect(level1.level).toBe(1);
    expect(level1.action).toBe('record_observation');

    const level2 = evaluateHealthAnomaly(STABLE_HISTORY, {
      status: 'ok',
      errorRate: 0.022, // ~2.3σ
      latencyMs: 105,
    });
    expect(level2.level).toBe(2);
    expect(level2.action).toBe('read_only_diagnosis');

    const level3 = evaluateHealthAnomaly(STABLE_HISTORY, {
      status: 'ok',
      errorRate: 0.12, // > 5% hard SLO and >> 3σ
      latencyMs: 105,
    });
    expect(level3.level).toBe(3);
    expect(level3.action).toBe('create_incident_intent');
  });

  it('automatically generates a structured intent-INC-*.md artifact on Level 3 breach', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgnaydi-monitor-'));
    dirs.push(tmpDir);
    const historyPath = path.join(tmpDir, 'history.json');
    const incidentDir = path.join(tmpDir, 'incidents');
    await fs.writeFile(historyPath, JSON.stringify(STABLE_HISTORY), 'utf-8');

    const { evaluation, incidentFilePath } = await runAnomalyCheck({
      historyPath,
      incidentDir,
      sample: {
        timestamp: '2026-11-20T04:00:00Z',
        status: 'degraded',
        errorRate: 0.18,
        latencyMs: 420,
        storageMode: 'upstash',
        providerMode: 'SANDBOX',
        commitSha: 'abc1234',
      },
    });

    expect(evaluation.level).toBe(3);
    expect(incidentFilePath).not.toBeNull();

    const content = await fs.readFile(incidentFilePath!, 'utf-8');
    expect(content).toContain('Автоматическая постановка по инциденту');
    expect(content).toContain('abc1234');
    expect(content).toContain('18.00%');
    expect(content).toContain('Затронутые системы');
    expect(content).toContain('Открытые вопросы');
  });
});
