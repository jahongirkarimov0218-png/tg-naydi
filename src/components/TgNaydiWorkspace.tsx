'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCsvBuffer, type ParsedCsvResult } from '@/lib/csv-parser';
import { KAZAN_SAMPLE_CSV_BYTES, KAZAN_SAMPLE_FILENAME } from '@/lib/sample-data';
import type {
  ProviderMode,
  PublicJobView,
  StorageMode,
  SupportedCountry,
} from '@/lib/types';
import { ModeBanner } from '@/components/ModeBanner';
import { UploadPanel } from '@/components/UploadPanel';
import { LiveMonitorCard } from '@/components/LiveMonitorCard';
import { ResultsCard } from '@/components/ResultsCard';
import { LandingSections } from '@/components/LandingSections';

const LAST_JOB_KEY = 'tgnaydi:lastJobId';
const UPLOAD_CHUNK_SIZE = 500;

interface TgNaydiWorkspaceProps {
  initialProviderMode: ProviderMode;
  initialStorageMode: StorageMode;
  initialWorkerOnline: boolean;
}

export function TgNaydiWorkspace({
  initialProviderMode,
  initialStorageMode,
  initialWorkerOnline,
}: TgNaydiWorkspaceProps) {
  const [providerMode] = useState<ProviderMode>(initialProviderMode);
  const [storageMode] = useState<StorageMode>(initialStorageMode);
  const [workerOnline, setWorkerOnline] = useState<boolean>(initialWorkerOnline);

  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [defaultCountry, setDefaultCountry] = useState<SupportedCountry>('RU');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedCsvResult | null>(null);

  const [batchSize, setBatchSize] = useState<number>(5);
  const [pauseMs, setPauseMs] = useState<number>(
    initialProviderMode === 'LIVE_MTPROTO' ? 15_000 : 600
  );

  const [job, setJob] = useState<PublicJobView | null>(null);
  const [filter, setFilter] = useState<'all' | 'person' | 'channel' | 'bot'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [showOperatorModal, setShowOperatorModal] = useState(false);
  const [operatorKey, setOperatorKey] = useState('');
  const [operatorError, setOperatorError] = useState<string | null>(null);

  const steppingRef = useRef(false);

  const syncUrlWithJob = (jobId: string | null) => {
    const url = new URL(window.location.href);
    if (jobId) {
      url.searchParams.set('job', jobId);
      window.localStorage.setItem(LAST_JOB_KEY, jobId);
    } else {
      url.searchParams.delete('job');
      window.localStorage.removeItem(LAST_JOB_KEY);
    }
    window.history.replaceState({}, '', url.toString());
  };

  const fetchJobFromServer = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}?limit=200`, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 404 || res.status === 401) {
          syncUrlWithJob(null);
          setJob(null);
        }
        return;
      }
      const data = (await res.json()) as { job: PublicJobView };
      setJob(data.job);
    } catch {
      // keep existing UI state on transient network glitch
    }
  }, []);

  // F5 recovery: restore ONLY jobId from URL / localStorage pointer, fetch truth from server JobStore
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job') || window.localStorage.getItem(LAST_JOB_KEY);
    if (jobId) {
      void fetchJobFromServer(jobId);
    }
  }, [fetchJobFromServer]);

  // Periodically refresh /api/health workerOnline indicator in LIVE_MTPROTO mode
  useEffect(() => {
    if (providerMode !== 'LIVE_MTPROTO') return;
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { workerOnline?: boolean };
          setWorkerOnline(Boolean(data.workerOnline));
        }
      } catch {
        // ignore
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [providerMode]);

  // Drive SANDBOX steps or LIVE_MTPROTO polling while job is active
  useEffect(() => {
    if (!job) return;

    if (job.status === 'rate_limited') {
      const waitMs = Math.max(1000, (job.retryAfterSec ?? 1) * 1000);
      const timer = setTimeout(() => {
        void fetchJobFromServer(job.id);
      }, Math.min(waitMs, 1000));
      return () => clearTimeout(timer);
    }

    if (job.status !== 'running' && job.status !== 'queued') {
      return;
    }

    if (job.providerMode === 'LIVE_MTPROTO') {
      const timer = setInterval(() => {
        void fetchJobFromServer(job.id);
      }, 2500);
      return () => clearInterval(timer);
    }

    // SANDBOX step driver
    const timer = setTimeout(async () => {
      if (steppingRef.current) return;
      steppingRef.current = true;
      setIsStepping(true);
      try {
        const res = await fetch(`/api/jobs/${job.id}/step`, { method: 'POST' });
        if (res.ok || res.status === 429) {
          const data = (await res.json()) as { job?: PublicJobView };
          if (data.job) setJob(data.job);
        }
      } finally {
        steppingRef.current = false;
        setIsStepping(false);
      }
    }, job.pauseMs);

    return () => clearTimeout(timer);
  }, [job, fetchJobFromServer]);

  const reparse = (bytes: Uint8Array, country: SupportedCountry, colOverride?: string) => {
    const result = parseCsvBuffer(bytes, country, colOverride);
    setParsed(result);
    setSelectedColumn(result.selectedColumn);
  };

  const handleFileSelected = async (file: File) => {
    setErrorText(null);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    setRawBytes(bytes);
    setFileName(file.name);
    reparse(bytes, defaultCountry);
  };

  const handleLoadKazanSample = () => {
    setErrorText(null);
    setRawBytes(KAZAN_SAMPLE_CSV_BYTES);
    setFileName(KAZAN_SAMPLE_FILENAME);
    setDefaultCountry('RU');
    reparse(KAZAN_SAMPLE_CSV_BYTES, 'RU');
  };

  const handleCountryChange = (c: SupportedCountry) => {
    setDefaultCountry(c);
    if (rawBytes) reparse(rawBytes, c, selectedColumn || undefined);
  };

  const handleColumnChange = (col: string) => {
    setSelectedColumn(col);
    if (rawBytes) reparse(rawBytes, defaultCountry, col);
  };

  const handleStartJob = async () => {
    if (!parsed || parsed.uniquePhones.length === 0) return;
    setErrorText(null);
    setIsSubmitting(true);

    try {
      const createRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: fileName || 'contacts.csv',
          batchSize,
          pauseMs,
          defaultCountry,
          totalSourceRows: parsed.totalRows,
          duplicatesRemoved: parsed.duplicatesRemoved,
          invalidRows: parsed.invalidRows,
        }),
      });

      if (createRes.status === 401) {
        setShowOperatorModal(true);
        setErrorText('Введите ключ оператора для запуска в режиме LIVE MTProto.');
        return;
      }

      if (!createRes.ok) {
        const err = (await createRes.json().catch(() => ({}))) as { error?: string };
        setErrorText(err.error || 'Не удалось создать задачу');
        return;
      }

      const created = (await createRes.json()) as { job: PublicJobView };
      const jobId = created.job.id;

      // Upload normalized unique numbers in <= 500 chunks (~25 KB << 4.5 MB Vercel limit)
      for (let i = 0; i < parsed.uniquePhones.length; i += UPLOAD_CHUNK_SIZE) {
        const slice = parsed.uniquePhones.slice(i, i + UPLOAD_CHUNK_SIZE);
        const chunkRes = await fetch(`/api/jobs/${jobId}/chunks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phones: slice }),
        });
        if (!chunkRes.ok) {
          const err = (await chunkRes.json().catch(() => ({}))) as { error?: string };
          setErrorText(err.error || 'Ошибка загрузки чанка номеров');
          return;
        }
      }

      const startRes = await fetch(`/api/jobs/${jobId}/start`, { method: 'POST' });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => ({}))) as { error?: string };
        setErrorText(err.error || 'Не удалось запустить проверку');
        return;
      }

      const started = (await startRes.json()) as { job: PublicJobView };
      syncUrlWithJob(started.job.id);
      setJob(started.job);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePause = async () => {
    if (!job) return;
    const res = await fetch(`/api/jobs/${job.id}/pause`, { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { job: PublicJobView };
      setJob(data.job);
    }
  };

  const handleResume = async () => {
    if (!job) return;
    const res = await fetch(`/api/jobs/${job.id}/resume`, { method: 'POST' });
    if (res.ok || res.status === 429) {
      const data = (await res.json()) as { job?: PublicJobView };
      if (data.job) setJob(data.job);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    if (res.ok) {
      syncUrlWithJob(null);
      setJob(null);
    }
  };

  const handleOperatorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setOperatorError(null);
    const res = await fetch('/api/auth/operator', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: operatorKey }),
    });
    if (!res.ok) {
      setOperatorError('Неверный ключ оператора');
      return;
    }
    setShowOperatorModal(false);
    setOperatorKey('');
  };

  return (
    <div className="min-h-screen">
      <ModeBanner
        providerMode={providerMode}
        storageMode={storageMode}
        workerOnline={workerOnline}
        onOpenOperatorModal={
          providerMode === 'LIVE_MTPROTO' ? () => setShowOperatorModal(true) : undefined
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero Header matching ref-02 */}
        <section className="max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-5xl sm:leading-[1.08]">
            Подготовь базу к рассылке в Telegram
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Загружаешь свою базу с номерами, получаешь тот же файл с username и типом аккаунта.
            Дальше писать можно по username, а не по номерам: меньше ошибок и ниже риск
            ограничений.
          </p>
        </section>

        {/* Interactive 2-column Workspace */}
        <section className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          <div className="lg:sticky lg:top-20 lg:col-span-5">
            <UploadPanel
              providerMode={providerMode}
              storageBlocked={storageMode === 'unconfigured'}
              fileName={fileName}
              parsed={parsed}
              defaultCountry={defaultCountry}
              batchSize={batchSize}
              pauseMs={pauseMs}
              selectedColumn={selectedColumn}
              isSubmitting={isSubmitting}
              errorText={errorText}
              onCountryChange={handleCountryChange}
              onBatchSizeChange={setBatchSize}
              onPauseMsChange={setPauseMs}
              onColumnChange={handleColumnChange}
              onFileSelected={(f) => void handleFileSelected(f)}
              onLoadKazanSample={handleLoadKazanSample}
              onStartJob={() => void handleStartJob()}
            />
          </div>

          <div className="space-y-6 lg:col-span-7">
            <LiveMonitorCard
              job={job}
              isStepping={isStepping}
              onPause={() => void handlePause()}
              onResume={() => void handleResume()}
              onDelete={() => void handleDelete()}
            />

            {job && <ResultsCard job={job} filter={filter} onFilterChange={setFilter} />}
          </div>
        </section>

        <LandingSections />
      </main>

      {/* Operator Auth Modal for LIVE_MTPROTO */}
      {showOperatorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={(e) => void handleOperatorLogin(e)}
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-slate-900">Ключ оператора</h3>
            <p className="mt-1 text-xs text-slate-500">
              Защищает подключённый Telegram-аккаунт от запусков посторонними посетителями.
            </p>
            <input
              type="password"
              value={operatorKey}
              onChange={(e) => setOperatorKey(e.target.value)}
              placeholder="Введите OPERATOR_ACCESS_KEY"
              className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            {operatorError && <p className="mt-2 text-xs text-red-600">{operatorError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowOperatorModal(false)}
                className="rounded-xl px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Подтвердить
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
