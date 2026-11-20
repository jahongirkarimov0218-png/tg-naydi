'use client';

import { FileText, Loader2, Pause, Play, Trash2 } from 'lucide-react';
import type { PublicJobItem, PublicJobView } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

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
      <Badge variant="darkNeutral">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        проверяем
      </Badge>
    );
  }

  switch (job.status) {
    case 'running':
      return (
        <Badge variant="darkNeutral" data-testid="job-status-badge">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-200 motion-reduce:animate-none" />
          проверяем
        </Badge>
      );
    case 'queued':
      return (
        <Badge variant="darkNeutral" data-testid="job-status-badge">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />в очереди воркера
        </Badge>
      );
    case 'paused':
      return (
        <Badge variant="darkAmber" data-testid="job-status-badge">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          на паузе
        </Badge>
      );
    case 'rate_limited':
      return (
        <Badge variant="darkAmber" data-testid="job-status-badge" className="tabular-nums">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 motion-reduce:animate-none" />
          пауза FLOOD_WAIT: {job.retryAfterSec ?? 0}с
        </Badge>
      );
    case 'completed':
      return (
        <Badge variant="darkEmerald" data-testid="job-status-badge">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          готово
        </Badge>
      );
    default:
      return (
        <Badge variant="darkNeutral" data-testid="job-status-badge">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
          {job.status}
        </Badge>
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
  // Sliding window centered on the active pending frontier so large (>12 row) jobs keep scrolling live
  const rows = (() => {
    if (!job) return PREVIEW_ROWS;
    const windowSize = 12;
    if (job.items.length <= windowSize) return job.items;
    const firstPending = job.items.findIndex((r) => r.status === 'pending');
    if (firstPending === -1) return job.items.slice(0, windowSize);
    const start = Math.max(0, Math.min(firstPending - 3, job.items.length - windowSize));
    return job.items.slice(start, start + windowSize);
  })();
  const activeIdx =
    job && job.status === 'running'
      ? rows.findIndex((r) => r.status === 'pending')
      : !job
        ? 0
        : -1;

  const displayFileName = job ? job.fileName : 'база.csv';

  return (
    <div
      data-testid="live-monitor-card"
      className="overflow-hidden rounded-xl border border-zinc-800/90 bg-[#09090B] text-zinc-100 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6 sm:py-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-100">
            <FileText className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div
              data-testid="monitor-filename"
              title={displayFileName}
              className="truncate text-sm font-semibold tracking-tight text-zinc-50"
            >
              {displayFileName}
            </div>
            <div className="text-xs text-zinc-400 tabular-nums">
              {job
                ? `Обработано ${job.stats.processed} из ${job.stats.total}`
                : 'Предпросмотр живого монитора'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusDot job={job} />
          {job && (job.status === 'running' || job.status === 'queued') && (
            <Button
              variant="darkSecondary"
              size="sm"
              data-testid="pause-job-btn"
              onClick={onPause}
            >
              <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
              Пауза
            </Button>
          )}
          {job && (job.status === 'paused' || job.status === 'rate_limited') && (
            <Button
              variant="darkPrimary"
              size="sm"
              data-testid="resume-job-btn"
              disabled={job.status === 'rate_limited' && (job.retryAfterSec ?? 0) > 0}
              onClick={onResume}
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              Продолжить
            </Button>
          )}
          {job && (
            <Button
              variant="darkDestructive"
              size="sm"
              data-testid="delete-job-btn"
              onClick={onDelete}
              title="Удалить загруженную базу и результаты немедленно"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              Удалить
            </Button>
          )}
        </div>
      </div>

      {/* Flattened edge-to-edge monitor table inside the obsidian shell */}
      <div className="border-t border-zinc-800/80 bg-[#111113]">
        <div className="grid grid-cols-12 border-b border-zinc-800/80 bg-zinc-900/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-6">
          <div className="col-span-5">Телефон</div>
          <div className="col-span-4">Telegram</div>
          <div className="col-span-3 text-right">Тип</div>
        </div>

        <div className="monitor-scroll max-h-[300px] divide-y divide-zinc-800/70 overflow-y-auto">
          {rows.map((item, idx) => {
            const isActive = idx === activeIdx && (isStepping || !job || job.status === 'running');
            return (
              <div
                key={item.index}
                className={cn(
                  'relative grid grid-cols-12 items-center gap-1 px-4 py-2.5 text-xs transition-colors duration-150 sm:px-6 sm:py-3',
                  isActive &&
                    'bg-zinc-900/90 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-zinc-200'
                )}
              >
                <div className="col-span-5 font-mono text-xs whitespace-nowrap text-zinc-200 tabular-nums">
                  {item.maskedPhone}
                </div>
                <div className="col-span-4 truncate font-mono text-xs text-zinc-300 tabular-nums">
                  {item.status === 'found' ? (
                    <span className="text-zinc-50" title={item.username}>
                      {item.username}
                    </span>
                  ) : item.status === 'found_no_username' ? (
                    <span className="text-zinc-400">без username</span>
                  ) : item.status === 'not_found_or_hidden' ? (
                    <span className="text-zinc-400">—</span>
                  ) : (
                    <span className="text-zinc-400">···</span>
                  )}
                </div>
                <div className="col-span-3 flex justify-end">
                  {isActive ? (
                    <Loader2
                      aria-label="Проверяется"
                      className="h-3.5 w-3.5 animate-spin text-zinc-300 motion-reduce:animate-none"
                      strokeWidth={1.75}
                    />
                  ) : item.status === 'found' && item.accountType === 'channel' ? (
                    <Badge variant="darkAmber">канал</Badge>
                  ) : item.status === 'found' && item.accountType === 'bot' ? (
                    <Badge variant="darkViolet">бот</Badge>
                  ) : item.status === 'found' ? (
                    <Badge variant="darkEmerald">человек</Badge>
                  ) : item.status === 'not_found_or_hidden' ? (
                    <span className="text-right text-xs leading-tight text-zinc-400">
                      не найден / скрыт
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">ожидает</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {job && job.totalItems > rows.length && (
        <p className="border-t border-zinc-800/80 bg-[#09090B] px-4 py-2.5 text-right text-xs text-zinc-400 tabular-nums sm:px-6">
          Показано {rows.length} из {job.totalItems} номеров — все строки доступны в result.csv
        </p>
      )}
    </div>
  );
}
