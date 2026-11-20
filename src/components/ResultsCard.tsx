'use client';

import { useState } from 'react';
import { Check, Copy, Download, FileCheck2, FileSpreadsheet } from 'lucide-react';
import type { PublicJobView } from '@/lib/types';

interface ResultsCardProps {
  job: PublicJobView;
  filter: 'all' | 'person' | 'channel' | 'bot';
  onFilterChange: (f: 'all' | 'person' | 'channel' | 'bot') => void;
}

export function ResultsCard({ job, filter, onFilterChange }: ResultsCardProps) {
  const [copiedHandle, setCopiedHandle] = useState<string | null>(null);
  const progressPct =
    job.stats.total > 0 ? Math.round((job.stats.processed / job.stats.total) * 100) : 0;

  const foundItems = job.items.filter(
    (i): i is Extract<(typeof job.items)[number], { status: 'found' }> => {
      if (i.status !== 'found') return false;
      if (filter === 'all') return true;
      return i.accountType === filter;
    }
  );

  const handleCopy = async (username: string) => {
    try {
      await navigator.clipboard.writeText(username);
      setCopiedHandle(username);
      setTimeout(() => setCopiedHandle(null), 1500);
    } catch {
      // Clipboard unavailable in headless test
    }
  };

  return (
    <div data-testid="results-card" className="space-y-4">
      {/* Pipeline progress card matching ref-01 */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">{job.fileName}</div>
              <div className="text-xs text-slate-500">{job.stats.total} номеров</div>
            </div>
          </div>

          <div className="hidden h-0.5 flex-1 bg-gradient-to-r from-blue-400 via-sky-300 to-emerald-400 sm:block" />

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-bold text-slate-900">result.csv</div>
              <div className="text-xs text-slate-500">username и тип</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm">
              <FileCheck2 className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between text-xs font-semibold">
          <span
            className={
              job.status === 'completed'
                ? 'text-emerald-600'
                : job.status === 'paused' || job.status === 'rate_limited'
                  ? 'text-amber-600'
                  : 'text-blue-600'
            }
          >
            {job.status === 'completed'
              ? 'Готово'
              : job.status === 'paused'
                ? 'На паузе'
                : job.status === 'rate_limited'
                  ? `Пауза FLOOD_WAIT (${job.retryAfterSec ?? 0}с)`
                  : 'Проверяем пачками...'}
          </span>
          <span data-testid="progress-counter" className="text-slate-500">
            {job.stats.processed} из {job.stats.total}
          </span>
        </div>

        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Summary KPI + found tags matching ref-02 */}
      <div className="rounded-3xl border border-slate-800/90 bg-[#14171F] p-5 shadow-lg sm:p-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Check className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-bold text-slate-900">{job.fileName}</div>
                <div className="text-[11px] font-semibold text-emerald-600">
                  {job.status === 'completed' ? 'готово' : `прогресс ${progressPct}%`} · режим{' '}
                  {job.providerMode}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                data-testid="download-csv-btn"
                href={`/api/jobs/${job.id}/export?delimiter=semicolon`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                Скачать result.csv (Excel)
              </a>
              <a
                data-testid="download-only-found-btn"
                href={`/api/jobs/${job.id}/export?delimiter=semicolon&onlyFound=1`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Только с username
              </a>
            </div>
          </div>

          <div
            className={`mt-4 grid gap-3 ${
              job.stats.botWithUsername > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
            }`}
          >
            <div className="rounded-2xl bg-slate-50 p-3.5">
              <div
                data-testid="stat-found-total"
                className="text-2xl font-extrabold tracking-tight text-slate-900"
              >
                {job.stats.foundWithUsername}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">найден username</div>
            </div>
            <div className="rounded-2xl bg-emerald-50/70 p-3.5">
              <div
                data-testid="stat-found-person"
                className="text-2xl font-extrabold tracking-tight text-emerald-600"
              >
                {job.stats.personWithUsername}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">человек, пиши</div>
            </div>
            <div className="rounded-2xl bg-amber-50/80 p-3.5">
              <div
                data-testid="stat-found-channel"
                className="text-2xl font-extrabold tracking-tight text-amber-600"
              >
                {job.stats.channelWithUsername}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">канал</div>
            </div>
            {job.stats.botWithUsername > 0 && (
              <div className="rounded-2xl bg-purple-50/80 p-3.5">
                <div
                  data-testid="stat-found-bot"
                  className="text-2xl font-extrabold tracking-tight text-purple-600"
                >
                  {job.stats.botWithUsername}
                </div>
                <div className="mt-0.5 text-xs text-slate-600">бот</div>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>Не найден / скрыт приватностью: {job.stats.notFoundOrHidden}</span>
            <div className="flex items-center gap-1">
              {(
                [
                  ['all', 'Все'],
                  ['person', 'Человек'],
                  ['channel', 'Канал'],
                  ...(job.stats.botWithUsername > 0 ? ([['bot', 'Бот']] as const) : []),
                ] as Array<readonly ['all' | 'person' | 'channel' | 'bot', string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onFilterChange(key)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    filter === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tag list matching bottom-right card of ref-02 */}
        {foundItems.length > 0 && (
          <div className="mt-3 rounded-2xl bg-white p-3.5 shadow-sm">
            <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {foundItems.slice(0, 50).map((item) => (
                <div
                  key={item.index}
                  className="flex items-center justify-between gap-2 py-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => item.username && void handleCopy(item.username)}
                    className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-800 hover:text-blue-600"
                  >
                    <span>{item.username}</span>
                    {copiedHandle === item.username ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3 text-slate-400" />
                    )}
                  </button>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      item.accountType === 'channel'
                        ? 'bg-sky-50 text-sky-700'
                        : item.accountType === 'bot'
                          ? 'bg-purple-50 text-purple-700'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {item.accountType === 'channel'
                      ? 'канал'
                      : item.accountType === 'bot'
                        ? 'бот'
                        : 'человек'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
