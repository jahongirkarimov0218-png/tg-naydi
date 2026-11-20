'use client';

import { useEffect, useState } from 'react';
import { parseCsvBuffer, type ParsedCsvResult } from '@/lib/csv-parser';
import { KAZAN_SAMPLE_CSV_BYTES, KAZAN_SAMPLE_FILENAME } from '@/lib/sample-data';
import type { ProviderMode, StorageMode, SupportedCountry } from '@/lib/types';
import { useTgNaydiJob } from '@/hooks/useTgNaydiJob';
import { ModeBanner } from '@/components/ModeBanner';
import { UploadPanel } from '@/components/UploadPanel';
import { LiveMonitorCard } from '@/components/LiveMonitorCard';
import { ResultsCard } from '@/components/ResultsCard';
import { LandingSections } from '@/components/LandingSections';
import { Button } from '@/components/ui/button';

const MAX_CLIENT_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per spec.md §3.1

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
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [defaultCountry, setDefaultCountry] = useState<SupportedCountry>('RU');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedCsvResult | null>(null);
  const [batchSize, setBatchSize] = useState<number>(5);
  const [pauseMs, setPauseMs] = useState<number>(
    initialProviderMode === 'LIVE_MTPROTO' ? 15_000 : 600
  );
  const [operatorKey, setOperatorKey] = useState('');
  const [operatorError, setOperatorError] = useState<string | null>(null);

  const {
    workerOnline,
    job,
    filter,
    isSubmitting,
    isStepping,
    errorText,
    setErrorText,
    showOperatorModal,
    setShowOperatorModal,
    startJob,
    pauseJob,
    resumeJob,
    deleteJob,
    changeFilter,
  } = useTgNaydiJob(initialProviderMode, initialWorkerOnline);

  useEffect(() => {
    if (!showOperatorModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowOperatorModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOperatorModal, setShowOperatorModal]);

  const reparse = (bytes: Uint8Array, country: SupportedCountry, colOverride?: string) => {
    const result = parseCsvBuffer(bytes, country, colOverride);
    setParsed(result);
    setSelectedColumn(result.selectedColumn);
  };

  const handleFileSelected = async (file: File) => {
    setErrorText(null);
    if (file.size > MAX_CLIENT_FILE_BYTES) {
      setErrorText('Файл превышает лимит 20 МБ. Разбейте базу на части или удалите лишние колонки.');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
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
        providerMode={initialProviderMode}
        storageMode={initialStorageMode}
        workerOnline={workerOnline}
        onOpenOperatorModal={
          initialProviderMode === 'LIVE_MTPROTO' ? () => setShowOperatorModal(true) : undefined
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="max-w-3xl">
          <h1 className="text-3xl font-semibold tracking-[-0.03em] text-balance text-zinc-950 sm:text-5xl sm:leading-[1.08]">
            Подготовь базу к рассылке в Telegram
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-pretty text-zinc-600 sm:text-[17px]">
            Загружаешь свою базу с номерами, получаешь тот же файл с username и типом аккаунта.
            Дальше писать можно по username, а не по номерам: меньше ошибок и ниже риск ограничений.
          </p>
        </section>

        <section className="mt-8 grid grid-cols-1 items-start gap-6 lg:mt-10 lg:grid-cols-12">
          <div className="lg:sticky lg:top-20 lg:col-span-5">
            <UploadPanel
              providerMode={initialProviderMode}
              storageBlocked={initialStorageMode === 'unconfigured'}
              fileName={fileName}
              parsed={parsed}
              defaultCountry={defaultCountry}
              batchSize={batchSize}
              pauseMs={pauseMs}
              selectedColumn={selectedColumn}
              isSubmitting={isSubmitting}
              errorText={errorText}
              onCountryChange={(c) => {
                setDefaultCountry(c);
                if (rawBytes) reparse(rawBytes, c, selectedColumn || undefined);
              }}
              onBatchSizeChange={setBatchSize}
              onPauseMsChange={setPauseMs}
              onColumnChange={(col) => {
                setSelectedColumn(col);
                if (rawBytes) reparse(rawBytes, defaultCountry, col);
              }}
              onFileSelected={(f) => void handleFileSelected(f)}
              onLoadKazanSample={handleLoadKazanSample}
              onStartJob={() => {
                if (parsed && parsed.uniquePhones.length > 0) {
                  void startJob({ parsed, fileName, batchSize, pauseMs, defaultCountry });
                }
              }}
            />
          </div>

          <div className="space-y-6 lg:col-span-7">
            <LiveMonitorCard
              job={job}
              isStepping={isStepping}
              onPause={() => void pauseJob()}
              onResume={() => void resumeJob()}
              onDelete={() => void deleteJob()}
            />
            {job && <ResultsCard job={job} filter={filter} onFilterChange={changeFilter} />}
          </div>
        </section>

        <LandingSections />
      </main>

      {showOperatorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowOperatorModal(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="operator-modal-title"
            onSubmit={(e) => void handleOperatorLogin(e)}
            className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-xs"
          >
            <h3
              id="operator-modal-title"
              className="text-base font-semibold tracking-tight text-balance text-zinc-950"
            >
              Ключ оператора
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-pretty text-zinc-600">
              Защищает подключённый Telegram-аккаунт от запусков посторонними посетителями.
            </p>
            <input
              type="password"
              autoFocus
              aria-label="Ключ оператора"
              value={operatorKey}
              onChange={(e) => setOperatorKey(e.target.value)}
              placeholder="Введите OPERATOR_ACCESS_KEY"
              className="mt-4 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 shadow-xs transition-colors duration-150 placeholder:text-zinc-500 focus-visible:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 sm:h-9 sm:text-sm"
            />
            {operatorError && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {operatorError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="md" onClick={() => setShowOperatorModal(false)}>
                Отмена
              </Button>
              <Button type="submit" variant="primary" size="md">
                Подтвердить
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
