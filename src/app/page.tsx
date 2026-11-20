import { getProviderMode } from '@/lib/auth';
import { getJobStore, getStorageMode } from '@/lib/job-store';
import { TgNaydiWorkspace } from '@/components/TgNaydiWorkspace';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const providerMode = getProviderMode();
  const storageMode = getStorageMode();
  const store = getJobStore();

  let workerOnline = false;
  if (store && providerMode === 'LIVE_MTPROTO') {
    try {
      const hb = await store.getWorkerHeartbeat();
      workerOnline = hb !== null && Date.now() - hb < 45_000;
    } catch {
      workerOnline = false;
    }
  }

  return (
    <TgNaydiWorkspace
      initialProviderMode={providerMode}
      initialStorageMode={storageMode}
      initialWorkerOnline={workerOnline}
    />
  );
}
