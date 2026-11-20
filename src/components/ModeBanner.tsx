'use client';

import { AlertTriangle, CheckCircle2, Radio, ShieldCheck } from 'lucide-react';
import type { ProviderMode, StorageMode } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';

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
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#FAFAFA]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-900">
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-zinc-950">TG Naydi</div>
            <div className="text-[11px] text-zinc-500">Подготовка своей базы к Telegram</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isSandbox ? (
            <Badge
              variant="amber"
              data-testid="mode-badge"
              title="Проверка имитируется детерминированно без живого Telegram-аккаунта. Подключите MTProto-воркер для реальных баз."
              className="px-2.5 py-1 text-xs"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              ДЕМО-РЕЖИМ (SANDBOX)
            </Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="emerald" data-testid="mode-badge" className="px-2.5 py-1 text-xs">
                <Radio className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
                LIVE MTProto · {workerOnline ? 'Воркер онлайн' : 'Воркер офлайн'}
              </Badge>
              {onOpenOperatorModal && (
                <Button variant="outline" size="sm" onClick={onOpenOperatorModal}>
                  Ключ оператора
                </Button>
              )}
            </div>
          )}

          <a
            href="/api/health"
            target="_blank"
            rel="noreferrer"
            className={buttonClasses('outline', 'sm')}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
            Статус
          </a>
        </div>
      </div>

      {storageMode === 'unconfigured' && (
        <div
          data-testid="storage-warning"
          className="border-t border-amber-200/80 bg-amber-50/90 px-4 py-2.5 text-center text-xs font-medium text-amber-900"
        >
          <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.75} />
            <span>
              На Vercel не подключён Upstash Redis (
              <code className="rounded-md border border-amber-200/80 bg-white/80 px-1.5 py-0.5 font-mono text-[11px]">
                UPSTASH_REDIS_REST_URL
              </code>{' '}
              /{' '}
              <code className="rounded-md border border-amber-200/80 bg-white/80 px-1.5 py-0.5 font-mono text-[11px]">
                UPSTASH_REDIS_REST_TOKEN
              </code>
              ). Запуск новых проверок отключён до подключения хранилища, чтобы прогресс не
              терялся после F5.
            </span>
          </span>
        </div>
      )}
    </header>
  );
}
