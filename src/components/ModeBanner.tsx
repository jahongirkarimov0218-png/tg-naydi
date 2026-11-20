'use client';

import { AlertTriangle, CheckCircle2, ShieldCheck, Radio } from 'lucide-react';
import type { ProviderMode, StorageMode } from '@/lib/types';

interface ModeBannerProps {
  providerMode: ProviderMode;
  storageMode: StorageMode;
  workerOnline: boolean;
  onOpenOperatorModal?: () => void;
}

export function ModeBanner({
  providerMode,
  storageMode,
  workerOnline,
  onOpenOperatorModal,
}: ModeBannerProps) {
  const isSandbox = providerMode === 'SANDBOX';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-slate-900">TG Naydi</div>
            <div className="text-[11px] text-slate-500">Подготовка своей базы к Telegram</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSandbox ? (
            <span
              data-testid="mode-badge"
              title="Проверка имитируется детерминированно без живого Telegram-аккаунта. Подключите MTProto-воркер для реальных баз."
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
            >
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              ДЕМО-РЕЖИМ (SANDBOX)
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span
                data-testid="mode-badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"
              >
                <Radio className="h-3.5 w-3.5 text-emerald-600" />
                LIVE MTProto · {workerOnline ? 'Воркер онлайн' : 'Воркер офлайн'}
              </span>
              {onOpenOperatorModal && (
                <button
                  type="button"
                  onClick={onOpenOperatorModal}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ключ оператора
                </button>
              )}
            </div>
          )}

          <a
            href="/api/health"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Статус
          </a>
        </div>
      </div>

      {storageMode === 'unconfigured' && (
        <div
          data-testid="storage-warning"
          className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-900"
        >
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            На Vercel не подключён Upstash Redis (
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
              UPSTASH_REDIS_REST_URL
            </code>{' '}
            /{' '}
            <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
              UPSTASH_REDIS_REST_TOKEN
            </code>
            ). Запуск новых проверок отключён до подключения хранилища, чтобы прогресс не терялся
            после F5.
          </span>
        </div>
      )}
    </header>
  );
}
