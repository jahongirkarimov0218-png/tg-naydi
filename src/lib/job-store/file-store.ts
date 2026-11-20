import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Job, RecentJobMetrics } from '@/lib/types';
import type { JobStore } from '@/lib/job-store/types';

interface LockRecord {
  owner: string;
  expiresAt: number;
}

interface MetricsRecord {
  completed: number;
  failed: number;
  rateLimited: number;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function assertSafeId(id: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid job id: ${id}`);
  }
}

export class FileJobStore implements JobStore {
  private readonly baseDir: string;

  constructor(baseDir: string = process.env.TGNAYDI_DATA_DIR || path.join(process.cwd(), '.data', 'jobs')) {
    this.baseDir = baseDir;
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  private jobPath(id: string): string {
    assertSafeId(id);
    return path.join(this.baseDir, `job-${id}.json`);
  }

  private lockPath(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, `lock-${safe}.json`);
  }

  private async atomicWriteJson(filePath: string, data: unknown): Promise<void> {
    await this.ensureDir();
    const tmpPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async getJob(id: string): Promise<Job | null> {
    if (!SAFE_ID_RE.test(id)) return null;
    const filePath = this.jobPath(id);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const job = JSON.parse(raw) as Job;
      if (job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now()) {
        await this.deleteJob(id);
        return null;
      }
      return job;
    } catch {
      return null;
    }
  }

  async saveJob(job: Job): Promise<void> {
    await this.atomicWriteJson(this.jobPath(job.id), job);
  }

  async deleteJob(id: string): Promise<void> {
    if (!SAFE_ID_RE.test(id)) return;
    await fs.rm(this.jobPath(id), { force: true });
    await fs.rm(this.lockPath(`job-${id}`), { force: true });
  }

  private async acquireNamedLock(name: string, ttlMs: number): Promise<string | null> {
    await this.ensureDir();
    const filePath = this.lockPath(name);
    const now = Date.now();

    // Check existing lock and remove if expired
    try {
      const existingRaw = await fs.readFile(filePath, 'utf-8');
      const existing = JSON.parse(existingRaw) as LockRecord;
      if (existing.expiresAt > now) {
        return null;
      }
      await fs.rm(filePath, { force: true });
    } catch {
      // No lock file or unreadable
    }

    const owner = crypto.randomUUID();
    const record: LockRecord = { owner, expiresAt: now + ttlMs };
    try {
      await fs.writeFile(filePath, JSON.stringify(record), { encoding: 'utf-8', flag: 'wx' });
      return owner;
    } catch {
      return null;
    }
  }

  private async releaseNamedLock(name: string, owner: string): Promise<void> {
    const filePath = this.lockPath(name);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const existing = JSON.parse(raw) as LockRecord;
      if (existing.owner === owner) {
        await fs.rm(filePath, { force: true });
      }
    } catch {
      // Already released
    }
  }

  async acquireJobLease(id: string, ttlMs: number): Promise<string | null> {
    assertSafeId(id);
    return this.acquireNamedLock(`job-${id}`, ttlMs);
  }

  async releaseJobLease(id: string, leaseId: string): Promise<void> {
    assertSafeId(id);
    await this.releaseNamedLock(`job-${id}`, leaseId);
  }

  async listActiveLiveJobs(): Promise<Job[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.baseDir);
    const jobs: Job[] = [];
    for (const file of files) {
      if (!file.startsWith('job-') || !file.endsWith('.json')) continue;
      const id = file.slice(4, -5);
      const job = await this.getJob(id);
      if (
        job &&
        job.providerMode === 'LIVE_MTPROTO' &&
        (job.status === 'queued' || job.status === 'running' || job.status === 'rate_limited')
      ) {
        jobs.push(job);
      }
    }
    jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return jobs;
  }

  async acquireGlobalSessionLock(ttlMs: number): Promise<string | null> {
    return this.acquireNamedLock('mtproto-global-session', ttlMs);
  }

  async releaseGlobalSessionLock(lockId: string): Promise<void> {
    await this.releaseNamedLock('mtproto-global-session', lockId);
  }

  async setWorkerHeartbeat(timestampMs: number): Promise<void> {
    await this.atomicWriteJson(path.join(this.baseDir, 'worker-heartbeat.json'), {
      timestampMs,
    });
  }

  async getWorkerHeartbeat(): Promise<number | null> {
    try {
      const raw = await fs.readFile(path.join(this.baseDir, 'worker-heartbeat.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { timestampMs?: number };
      return typeof parsed.timestampMs === 'number' ? parsed.timestampMs : null;
    } catch {
      return null;
    }
  }

  async setSessionCooldownUntil(timestampMs: number): Promise<void> {
    await this.atomicWriteJson(path.join(this.baseDir, 'session-cooldown.json'), {
      timestampMs,
    });
  }

  async getSessionCooldownUntil(): Promise<number | null> {
    try {
      const raw = await fs.readFile(path.join(this.baseDir, 'session-cooldown.json'), 'utf-8');
      const parsed = JSON.parse(raw) as { timestampMs?: number };
      return typeof parsed.timestampMs === 'number' ? parsed.timestampMs : null;
    } catch {
      return null;
    }
  }

  async recordJobOutcome(outcome: 'completed' | 'failed' | 'rate_limited'): Promise<void> {
    const filePath = path.join(this.baseDir, 'metrics.json');
    let current: MetricsRecord = { completed: 0, failed: 0, rateLimited: 0 };
    try {
      current = JSON.parse(await fs.readFile(filePath, 'utf-8')) as MetricsRecord;
    } catch {
      // initial
    }
    if (outcome === 'completed') current.completed += 1;
    if (outcome === 'failed') current.failed += 1;
    if (outcome === 'rate_limited') current.rateLimited += 1;
    await this.atomicWriteJson(filePath, current);
  }

  async getRecentMetrics(): Promise<RecentJobMetrics> {
    const filePath = path.join(this.baseDir, 'metrics.json');
    let current: MetricsRecord = { completed: 0, failed: 0, rateLimited: 0 };
    try {
      current = JSON.parse(await fs.readFile(filePath, 'utf-8')) as MetricsRecord;
    } catch {
      // initial
    }
    const total = current.completed + current.failed;
    return {
      recentJobsTotal: total,
      recentJobsCompleted: current.completed,
      recentJobsFailed: current.failed,
      recentFloodWaits: current.rateLimited,
      errorRate: total > 0 ? current.failed / total : 0,
    };
  }
}
