'use client';

import { useRef, useState } from 'react';
import { FileSpreadsheet, Play, Sparkles, Upload } from 'lucide-react';
import type { ParsedCsvResult } from '@/lib/csv-parser';
import type { ProviderMode, SupportedCountry } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

interface UploadPanelProps {
  providerMode: ProviderMode;
  storageBlocked: boolean;
  fileName: string | null;
  parsed: ParsedCsvResult | null;
  defaultCountry: SupportedCountry;
  batchSize: number;
  pauseMs: number;
  selectedColumn: string;
  isSubmitting: boolean;
  errorText: string | null;
  onCountryChange: (c: SupportedCountry) => void;
  onBatchSizeChange: (n: number) => void;
  onPauseMsChange: (n: number) => void;
  onColumnChange: (col: string) => void;
  onFileSelected: (file: File) => void;
  onLoadKazanSample: () => void;
  onStartJob: () => void;
}

const CONTROL_INPUT_CLASSES =
  'mt-1.5 h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-base font-medium text-zinc-950 shadow-xs transition-colors duration-150 focus-visible:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 sm:h-9 sm:text-xs';

export function UploadPanel({
  providerMode,
  storageBlocked,
  fileName,
  parsed,
  defaultCountry,
  batchSize,
  pauseMs,
  selectedColumn,
  isSubmitting,
  errorText,
  onCountryChange,
  onBatchSizeChange,
  onPauseMsChange,
  onColumnChange,
  onFileSelected,
  onLoadKazanSample,
  onStartJob,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const isLive = providerMode === 'LIVE_MTPROTO';

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragActive) setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-balance text-zinc-950">
          1. Загрузка своей базы
        </h2>
        <Button
          variant="secondary"
          size="sm"
          data-testid="load-sample-btn"
          onClick={onLoadKazanSample}
        >
          <Sparkles className="h-3.5 w-3.5 text-zinc-700" strokeWidth={1.75} />
          Пример (Контакты Казани.csv)
        </Button>
      </div>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={fileName ? `Выбран файл ${fileName}` : 'Перетащи CSV или TXT файл сюда'}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-7 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20',
          isDragActive
            ? 'border-zinc-900 bg-zinc-100/90 ring-2 ring-zinc-950/10'
            : 'border-zinc-300 bg-zinc-50/60 hover:border-zinc-400 hover:bg-zinc-100/60'
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-xs">
          {fileName ? (
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <Upload className="h-4 w-4" strokeWidth={1.75} />
          )}
        </div>
        <p
          title={fileName ?? undefined}
          className="mt-3 max-w-full truncate text-sm font-medium text-zinc-950"
        >
          {fileName ? fileName : 'Перетащи CSV или TXT файл сюда'}
        </p>
        <p className="mt-1 max-w-[36ch] text-xs text-pretty text-zinc-600">
          UTF-8 или Windows-1251 (Excel), разделитель «;» или «,», формат номеров любой
        </p>
        <input
          ref={inputRef}
          data-testid="csv-file-input"
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
          }}
        />
      </div>

      {/* Validation summary */}
      {parsed && (
        <div
          data-testid="validation-summary"
          className="mt-4 rounded-xl border border-zinc-200/80 bg-zinc-50/70 p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
            <span>
              Кодировка:{' '}
              <strong className="font-mono font-medium text-zinc-950">{parsed.encoding}</strong> ·
              Разделитель:{' '}
              <strong className="font-mono font-medium text-zinc-950">
                {parsed.delimiter === '\n' ? 'построчно' : `«${parsed.delimiter}»`}
              </strong>
            </span>
            {parsed.headers.length > 1 && (
              <label className="inline-flex items-center gap-1.5">
                <span>Колонка:</span>
                <select
                  value={selectedColumn}
                  onChange={(e) => onColumnChange(e.target.value)}
                  className="h-8 max-w-[160px] truncate rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-950 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 sm:h-7"
                >
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-white p-2.5 text-center">
              <div className="truncate text-base font-semibold tracking-tight text-zinc-950 tabular-nums">
                {parsed.totalRows}
              </div>
              <div className="mt-0.5 text-xs text-zinc-600">всего строк</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-white p-2.5 text-center">
              <div className="truncate text-base font-semibold tracking-tight text-emerald-700 tabular-nums">
                {parsed.uniquePhones.length}
              </div>
              <div className="mt-0.5 text-xs text-zinc-600">уникальных</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-white p-2.5 text-center">
              <div className="truncate text-base font-semibold tracking-tight text-zinc-700 tabular-nums">
                {parsed.duplicatesRemoved}
              </div>
              <div className="mt-0.5 text-xs text-zinc-600">дублей убрано</div>
            </div>
            <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-white p-2.5 text-center">
              <div
                className={cn(
                  'truncate text-base font-semibold tracking-tight tabular-nums',
                  parsed.invalidRows > 0 ? 'text-amber-800' : 'text-zinc-700'
                )}
              >
                {parsed.invalidRows}
              </div>
              <div className="mt-0.5 text-xs text-zinc-600">некорректных</div>
            </div>
          </div>
        </div>
      )}

      {/* Batch & region settings — keep exact number input order: 1st batchSize, 2nd pauseMs */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <label className="col-span-2 block min-w-0 sm:col-span-1">
          <span className="block text-xs font-medium text-zinc-600">Страна по умолч.</span>
          <select
            data-testid="country-select"
            value={defaultCountry}
            onChange={(e) => onCountryChange(e.target.value as SupportedCountry)}
            className={CONTROL_INPUT_CLASSES}
          >
            <option value="RU">RU (+7)</option>
            <option value="UZ">UZ (+998)</option>
            <option value="KZ">KZ (+7)</option>
            <option value="BY">BY (+375)</option>
            <option value="UA">UA (+380)</option>
            <option value="US">US (+1)</option>
          </select>
        </label>

        <label className="block min-w-0">
          <span className="block text-xs font-medium text-zinc-600">Пачка (шт)</span>
          <input
            type="number"
            min={1}
            max={isLive ? 15 : 25}
            value={batchSize}
            onChange={(e) => onBatchSizeChange(Number(e.target.value) || 5)}
            className={cn(CONTROL_INPUT_CLASSES, 'font-mono tabular-nums')}
          />
        </label>

        <label className="block min-w-0">
          <span className="block text-xs font-medium text-zinc-600">Пауза (мс)</span>
          <input
            type="number"
            min={isLive ? 15000 : 100}
            max={60000}
            step={100}
            value={pauseMs}
            onChange={(e) => onPauseMsChange(Number(e.target.value) || 800)}
            className={cn(CONTROL_INPUT_CLASSES, 'font-mono tabular-nums')}
          />
        </label>
      </div>

      {errorText && (
        <div
          data-testid="upload-error"
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50/80 px-3 py-2 text-xs font-medium text-red-700"
        >
          {errorText}
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        data-testid="start-check-btn"
        disabled={storageBlocked || !parsed || parsed.uniquePhones.length === 0 || isSubmitting}
        onClick={onStartJob}
        className="mt-4 w-full"
      >
        <Play className="h-4 w-4" strokeWidth={1.75} />
        {isSubmitting ? 'Создаём задачу...' : 'Запустить проверку'}
      </Button>
    </Card>
  );
}
