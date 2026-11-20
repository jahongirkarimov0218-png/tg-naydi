'use client';

import { FileText, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import type { PublicJobItem, PublicJobView } from '@/lib/types';

interface LiveMonitorCardProps {
  job: PublicJobView | null;
  isStepping: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}

const PREVIEW_ROWS: PublicJobItem[] = [
  { index: 0, maskedPhone: '+7 905 •••-45-67', status: 'checking' },
  { index: 1, maskedPhone: '+7 963 •••-65-43', status: 'pending' },
  { index: 2, maskedPhone: '+7 921 •••-12-34', status: 'pending' },
  { index: 3, maskedPhone: '+7 999 •••-22-33', status: 'pending' },
  { index: 4, maskedPhone: '+7 906 •••-44-55', status: 'pending' },
];

function StatusDot({ job }: { job: PublicJobView | null }) {
  if (!job) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        проверяем
      </span>
    );
  }

  switch (job.status) {
    case 'running':
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          проверяем
        </span>
      );
    case 'queued':
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400"
        >
          <span className="h-2 w-2 rounded-full bg-sky-400" />в очереди воркера
        </span>
      );
    case 'paused':
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400"
        >
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          на паузе
        </span>
      );
    case 'rate_limited':
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          пауза FLOOD_WAIT: {job.retryAfterSec ?? 0}с
        </span>
      );
    case 'completed':
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          готово
        </span>
      );
    default:
      return (
        <span
          data-testid="job-status-badge"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400"
        >
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          {job.status}
        </span>
      );
  }
}

export function LiveMonitorCard({
  job,
  isStepping,
  onPause,
  onResume,
  onDelete,
}: LiveMonitorCardProps) {
  const rows = job ? job.items.slice(0, 12) : PREVIEW_ROWS;
  const activeIdx =
    job && job.status === 'running'
      ? rows.findIndex((r) => r.status === 'pending')
      : !job
        ? 0
        : -1;

  return (
    <div
      data-testid="live-monitor-card"
      className="rounded-[28px] border border-slate-800 bg-[#111318] p-5 text-slate-100 shadow-xl sm:p-6"
    >
      {/* Header matching ref-02 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-inner">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div data-testid="monitor-filename" className="text-sm font-semibold text-white">
              {job ? job.fileName : 'база.csv'}
            </div>
            <div className="text-[11px] text-slate-400">
              {job
                ? `Обработано ${job.stats.processed} из ${job.stats.total}`
                : 'Предпросмотр живого монитора'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <StatusDot job={job} />
          {job && (job.status === 'running' || job.status === 'queued') && (
            <button
              type="button"
              data-testid="pause-job-btn"
              onClick={onPause}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700"
            >
              <Pause className="h-3.5 w-3.5" />
              Пауза
            </button>
          )}
          {job && (job.status === 'paused' || job.status === 'rate_limited') && (
            <button
              type="button"
              data-testid="resume-job-btn"
              disabled={job.status === 'rate_limited' && (job.retryAfterSec ?? 0) > 0}
              onClick={onResume}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Продолжить
            </button>
          )}
          {job && (
            <button
              type="button"
              data-testid="delete-job-btn"
              onClick={onDelete}
              title="Удалить загруженную базу и результаты немедленно"
              className="inline-flex items-center gap-1 rounded-xl border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-900/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить
            </button>
          )}
        </div>
      </div>

      {/* Table matching ref-02 */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800/90 bg-[#171A21]">
        <div className="grid grid-cols-12 border-b border-slate-800/80 px-4 py-2.5 text-[11px] font-medium text-slate-400">
          <div className="col-span-5">Телефон</div>
          <div className="col-span-4">Telegram</div>
          <div className="col-span-3 text-right">Тип</div>
        </div>

        <div className="max-h-[300px] divide-y divide-slate-800/70 overflow-y-auto">
          {rows.map((item, idx) => {
            const isActive = idx === activeIdx && (isStepping || !job || job.status === 'running');
            return (
              <div
                key={item.index}
                className={`grid grid-cols-12 items-center px-4 py-3 text-xs transition ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-950/60 via-slate-800/40 to-transparent'
                    : ''
                }`}
              >
                <div className="col-span-5 font-mono text-slate-200">{item.maskedPhone}</div>
                <div className="col-span-4 truncate font-mono text-slate-300">
                  {item.username ? (
                    <span className="text-white">{item.username}</span>
                  ) : item.status === 'found_no_username' ? (
                    <span className="text-slate-500">без username</span>
                  ) : item.status === 'not_found_or_hidden' ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <span className="text-slate-600">···</span>
                  )}
                </div>
                <div className="col-span-3 flex justify-end">
                  {isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  ) : item.status === 'found' && item.accountType === 'channel' ? (
                    <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      канал
                    </span>
                  ) : item.status === 'found' && item.accountType === 'bot' ? (
                    <span className="rounded-md bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-300">
                      бот
                    </span>
                  ) : item.status === 'found' ? (
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      человек
                    </span>
                  ) : item.status === 'not_found_or_hidden' ? (
                    <span className="text-[11px] text-slate-500">не найден / скрыт</span>
                  ) : (
                    <span className="text-[11px] text-slate-600">ожидает</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {job && job.totalItems > rows.length && (
        <p className="mt-2.5 text-right text-[11px] text-slate-500">
          Показано {rows.length} из {job.totalItems} номеров — все строки доступны в `result.csv`
        </p>
      )}
    </div>
  );
}
