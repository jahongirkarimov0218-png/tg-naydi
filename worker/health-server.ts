import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isWorkerHeartbeatFresh } from '@/lib/job-store/helpers';

export interface WorkerHealthState {
  connected: boolean;
  lastHeartbeatAtMs: number | null;
  startedAtMs: number;
}

export interface WorkerHealthServerHandle {
  port: number;
  close(): Promise<void>;
}

export function buildWorkerHealthPayload(
  state: WorkerHealthState,
  nowMs: number = Date.now()
): { statusCode: 200 | 503; body: Record<string, unknown> } {
  const heartbeatFresh = isWorkerHeartbeatFresh(state.lastHeartbeatAtMs, nowMs);
  const healthy = state.connected && heartbeatFresh;
  const lastHeartbeatAgeMs =
    state.lastHeartbeatAtMs !== null ? Math.max(0, nowMs - state.lastHeartbeatAtMs) : null;

  return {
    statusCode: healthy ? 200 : 503,
    body: {
      status: healthy ? 'ok' : 'degraded',
      connected: state.connected,
      heartbeatFresh,
      lastHeartbeatAgeMs,
      uptimeSec: Math.max(0, Math.floor((nowMs - state.startedAtMs) / 1000)),
      timestamp: new Date(nowMs).toISOString(),
    },
  };
}

export function startWorkerHealthServer(
  port: number,
  getState: () => WorkerHealthState,
  host: string = '0.0.0.0'
): Promise<WorkerHealthServerHandle> {
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/healthz')) {
      const { statusCode, body } = buildWorkerHealthPayload(getState());
      const payload = JSON.stringify(body);
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const addr = server.address() as AddressInfo | null;
      resolve({
        port: addr?.port ?? port,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}
