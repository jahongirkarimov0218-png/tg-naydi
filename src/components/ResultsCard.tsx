'use client';

import { useState } from 'react';
import { ArrowRight, Check, Copy, Download, FileCheck2, FileSpreadsheet } from 'lucide-react';
import type { PublicJobView } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonClasses } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

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

  const progressColorClass =
    job.status === 'completed'
      ? 'bg-emerald-600'
      : job.status === 'paused' || job.status === 'rate_limited'
        ? 'bg-amber-500'
        : 'bg-[#09090B]';

  return (
    <div data-testid="results-card" className="space-y-4">
      <span className="sr-only" aria-live="polite">
        {copiedHandle ? `Скопировано ${copiedHandle}` : ''}
      </span>

      {/* Pipeline progress card */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:max-w-[45%]">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
              <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div
                title={job.fileName}
                className="truncate text-sm font-semibold tracking-tight text-zinc-950"
              >
                {job.fileName}
              </div>
              <div className="text-xs text-zinc-600 tabular-nums">{job.stats.total} номеров</div>
            </div>
          </div>

          <div className="hidden flex-1 items-center gap-2 px-2 sm:flex">
            <div className="h-px flex-1 border-t border-dashed border-zinc-300" />
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
            <div className="h-px flex-1 border-t border-dashed border-zinc-300" />
          </div>

          <div className="flex flex-row-reverse items-center justify-end gap-3 sm:flex-row">
            <div className="text-left sm:text-right">
              <div className="text-sm font-semibold tracking-tight text-zinc-950">result.csv</div>
              <div className="text-xs text-zinc-600">username и тип</div>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
              <FileCheck2 className="h-4 w-4" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between text-xs font-medium">
          <span
            className={
              job.status === 'completed'
                ? 'text-emerald-700'
                : job.status === 'paused' || job.status === 'rate_limited'
                  ? 'text-amber-800'
                  : 'text-zinc-900'
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
          <span data-testid="progress-counter" className="font-mono text-zinc-600 tabular-nums">
            {job.stats.processed} из {job.stats.total}
          </span>
        </div>

        <div
          role="progressbar"
          aria-label="Прогресс проверки"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-zinc-100"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none',
              progressColorClass
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </Card>

      {/* Summary KPI + export + found handles */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
              <Check className="h-4 w-4 text-emerald-700" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div
                title={job.fileName}
                className="truncate text-sm font-semibold tracking-tight text-zinc-950"
              >
                {job.fileName}
              </div>
              <div
                className={cn(
                  'text-xs font-medium tabular-nums',
                  job.status === 'completed' ? 'text-emerald-700' : 'text-zinc-600'
                )}
              >
                {job.status === 'completed' ? 'готово' : `прогресс ${progressPct}%`} · режим{' '}
                {job.providerMode}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              data-testid="download-csv-btn"
              href={`/api/jobs/${job.id}/export?delimiter=semicolon`}
              className={buttonClasses('primary', 'md')}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              Скачать result.csv (Excel)
            </a>
            <a
              data-testid="download-only-found-btn"
              href={`/api/jobs/${job.id}/export?delimiter=semicolon&onlyFound=1`}
              className={buttonClasses('outline', 'md')}
            >
              Только с username
            </a>
          </div>
        </div>

        <div
          className={cn(
            'mt-5 grid gap-3',
            job.stats.botWithUsername > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'
          )}
        >
          <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3 sm:p-3.5">
            <div
              data-testid="stat-found-total"
              className="truncate text-xl font-semibold tracking-tight text-zinc-950 tabular-nums sm:text-2xl"
            >
              {job.stats.foundWithUsername}
            </div>
            <div className="mt-1 text-xs text-zinc-600">найден username</div>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3 sm:p-3.5">
            <div
              data-testid="stat-found-person"
              className="truncate text-xl font-semibold tracking-tight text-emerald-700 tabular-nums sm:text-2xl"
            >
              {job.stats.personWithUsername}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
              <span>человек, пиши</span>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3 sm:p-3.5">
            <div
              data-testid="stat-found-channel"
              className="truncate text-xl font-semibold tracking-tight text-amber-800 tabular-nums sm:text-2xl"
            >
              {job.stats.channelWithUsername}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
              <span>канал</span>
            </div>
          </div>

          {job.stats.botWithUsername > 0 && (
            <div className="min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/50 p-3 sm:p-3.5">
              <div
                data-testid="stat-found-bot"
                className="truncate text-xl font-semibold tracking-tight text-violet-800 tabular-nums sm:text-2xl"
              >
                {job.stats.botWithUsername}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-700">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600" />
                <span>бот</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 pt-4 text-xs text-zinc-600">
          <span>
            Не найден / скрыт приватностью:{' '}
            <span className="font-mono font-medium text-zinc-900 tabular-nums">
              {job.stats.notFoundOrHidden}
            </span>
          </span>

          <div
            role="group"
            aria-label="Фильтр по типу аккаунта"
            className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-200/80 bg-zinc-100/80 p-0.5"
          >
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
                aria-pressed={filter === key}
                onClick={() => onFilterChange(key)}
                className={cn(
                  'min-h-8 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20 sm:min-h-7',
                  filter === key
                    ? 'bg-white text-zinc-950 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-950'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {foundItems.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200/80 bg-white">
            <div className="max-h-56 divide-y divide-zinc-100 overflow-y-auto">
              {foundItems.slice(0, 50).map((item) => (
                <div
                  key={item.index}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors duration-150 hover:bg-zinc-50/80"
                >
                  <button
                    type="button"
                    aria-label={
                      copiedHandle === item.username
                        ? `Скопировано ${item.username}`
                        : `Скопировать ${item.username}`
                    }
                    onClick={() => item.username && void handleCopy(item.username)}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-sm font-mono font-medium text-zinc-900 transition-colors duration-150 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950/20"
                  >
                    <span className="truncate" title={item.username}>
                      {item.username}
                    </span>
                    {copiedHandle === item.username ? (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-emerald-700"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
                    )}
                  </button>
                  <Badge
                    variant={
                      item.accountType === 'channel'
                        ? 'amber'
                        : item.accountType === 'bot'
                          ? 'violet'
                          : 'emerald'
                    }
                  >
                    {item.accountType === 'channel'
                      ? 'канал'
                      : item.accountType === 'bot'
                        ? 'бот'
                        : 'человек'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
