'use client';

import { useRef } from 'react';
import { FileSpreadsheet, Play, Sparkles, Upload } from 'lucide-react';
import type { ParsedCsvResult } from '@/lib/csv-parser';
import type { ProviderMode, SupportedCountry } from '@/lib/types';

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
  const isLive = providerMode === 'LIVE_MTPROTO';

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
  };

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">1. Загрузка своей базы</h2>
        <button
          type="button"
          data-testid="load-sample-btn"
          onClick={onLoadKazanSample}
          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Пример (Контакты Казани.csv)
        </button>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-4 py-7 text-center transition hover:border-blue-400 hover:bg-blue-50/30"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100/80 text-blue-600">
          {fileName ? <FileSpreadsheet className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-800">
          {fileName ? fileName : 'Перетащи CSV или TXT файл сюда'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
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
          className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5"
        >
          {parsed.headers.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
              <label className="inline-flex items-center gap-1.5">
                <span>Колонка:</span>
                <select
                  value={selectedColumn}
                  onChange={(e) => onColumnChange(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-800"
                >
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-white p-2.5 text-center ring-1 ring-slate-200/70">
              <div className="text-base font-bold text-slate-900">{parsed.totalRows}</div>
              <div className="text-[11px] text-slate-500">всего строк</div>
            </div>
            <div className="rounded-xl bg-white p-2.5 text-center ring-1 ring-emerald-200/80">
              <div className="text-base font-bold text-emerald-700">
                {parsed.uniquePhones.length}
              </div>
              <div className="text-[11px] text-slate-500">уникальных</div>
            </div>
            <div className="rounded-xl bg-white p-2.5 text-center ring-1 ring-slate-200/70">
              <div className="text-base font-bold text-slate-700">{parsed.duplicatesRemoved}</div>
              <div className="text-[11px] text-slate-500">дублей убрано</div>
            </div>
            <div className="rounded-xl bg-white p-2.5 text-center ring-1 ring-amber-200/70">
              <div className="text-base font-bold text-amber-700">{parsed.invalidRows}</div>
              <div className="text-[11px] text-slate-500">некорректных</div>
            </div>
          </div>
        </div>
      )}

      {/* Batch & region settings */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <label className="block">
          <span className="text-[11px] font-medium text-slate-500">Страна по умолч.</span>
          <select
            data-testid="country-select"
            value={defaultCountry}
            onChange={(e) => onCountryChange(e.target.value as SupportedCountry)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-400"
          >
            <option value="RU">RU (+7)</option>
            <option value="UZ">UZ (+998)</option>
            <option value="KZ">KZ (+7)</option>
            <option value="BY">BY (+375)</option>
            <option value="UA">UA (+380)</option>
            <option value="US">US (+1)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-medium text-slate-500">Пачка (шт)</span>
          <input
            type="number"
            min={1}
            max={isLive ? 15 : 25}
            value={batchSize}
            onChange={(e) => onBatchSizeChange(Number(e.target.value) || 5)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-400"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-medium text-slate-500">Пауза (мс)</span>
          <input
            type="number"
            min={isLive ? 15000 : 100}
            max={60000}
            step={100}
            value={pauseMs}
            onChange={(e) => onPauseMsChange(Number(e.target.value) || 800)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-400"
          />
        </label>
      </div>

      {errorText && (
        <div
          data-testid="upload-error"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
        >
          {errorText}
        </div>
      )}

      <button
        type="button"
        data-testid="start-check-btn"
        disabled={storageBlocked || !parsed || parsed.uniquePhones.length === 0 || isSubmitting}
        onClick={onStartJob}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        <Play className="h-4 w-4 fill-current" />
        {isSubmitting ? 'Создаём задачу...' : 'Запустить проверку'}
      </button>
    </div>
  );
}
