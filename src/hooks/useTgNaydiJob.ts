'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedCsvResult } from '@/lib/csv-parser';
import type { ProviderMode, PublicJobView, SupportedCountry } from '@/lib/types';

const LAST_JOB_KEY = 'tgnaydi:lastJobId';
const UPLOAD_CHUNK_SIZE = 500;

export type UiJobFilter = 'all' | 'person' | 'channel' | 'bot';

function syncUrlWithJob(jobId: string | null): void {
  const url = new URL(window.location.href);
  if (jobId) {
    url.searchParams.set('job', jobId);
    window.localStorage.setItem(LAST_JOB_KEY, jobId);
  } else {
    url.searchParams.delete('job');
    window.localStorage.removeItem(LAST_JOB_KEY);
  }
  window.history.replaceState({}, '', url.toString());
}

export function useTgNaydiJob(providerMode: ProviderMode, initialWorkerOnline: boolean) {
  const [workerOnline, setWorkerOnline] = useState(initialWorkerOnline);
  const [job, setJob] = useState<PublicJobView | null>(null);
  const [filter, setFilter] = useState<UiJobFilter>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showOperatorModal, setShowOperatorModal] = useState(false);

  const steppingRef = useRef(false);
  const actionEpochRef = useRef(0);

  const fetchJobFromServer = useCallback(
    async (jobId: string, activeFilter: UiJobFilter = 'all') => {
      try {
        const res = await fetch(`/api/jobs/${jobId}?limit=200&filter=${activeFilter}`, {
          cache: 'no-store',
        });
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
        // retain current UI state on transient network glitch
      }
    },
    []
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('job') || window.localStorage.getItem(LAST_JOB_KEY);
    if (jobId) void fetchJobFromServer(jobId);
  }, [fetchJobFromServer]);

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
        // ignore transient poll failure
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [providerMode]);

  useEffect(() => {
    if (!job) return;

    if (job.status === 'rate_limited') {
      const remaining = job.retryAfterSec ?? 0;
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setJob((prev) =>
            prev && prev.id === job.id && prev.status === 'rate_limited'
              ? { ...prev, retryAfterSec: Math.max(0, (prev.retryAfterSec ?? 1) - 1) }
              : prev
          );
        }, 1000);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (job.status !== 'running' && job.status !== 'queued') return;

    if (job.providerMode === 'LIVE_MTPROTO') {
      const timer = setInterval(() => void fetchJobFromServer(job.id, filter), 2500);
      return () => clearInterval(timer);
    }

    const capturedEpoch = actionEpochRef.current;
    const capturedJobId = job.id;
    const timer = setTimeout(async () => {
      if (steppingRef.current) return;
      steppingRef.current = true;
      setIsStepping(true);
      try {
        const res = await fetch(`/api/jobs/${capturedJobId}/step`, { method: 'POST' });
        if (actionEpochRef.current !== capturedEpoch) return;
        if (res.ok || res.status === 429) {
          const data = (await res.json()) as { job?: PublicJobView };
          if (data.job && actionEpochRef.current === capturedEpoch) {
            setJob(data.job);
            setErrorText(null);
          }
        } else {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setErrorText(
            err.error || `Сервер вернул ошибку (${res.status}) при обработке пачки. Попробуйте продолжить.`
          );
          setJob((prev) => (prev && prev.id === capturedJobId ? { ...prev, status: 'paused' } : prev));
        }
      } catch {
        if (actionEpochRef.current === capturedEpoch) {
          setErrorText('Сбой сети при обработке пачки. Нажмите «Продолжить» после восстановления связи.');
          setJob((prev) => (prev && prev.id === capturedJobId ? { ...prev, status: 'paused' } : prev));
        }
      } finally {
        steppingRef.current = false;
        setIsStepping(false);
      }
    }, job.pauseMs);

    return () => clearTimeout(timer);
  }, [job, filter, fetchJobFromServer]);

  const startJob = async (params: {
    parsed: ParsedCsvResult;
    fileName: string | null;
    batchSize: number;
    pauseMs: number;
    defaultCountry: SupportedCountry;
  }) => {
    actionEpochRef.current += 1;
    setErrorText(null);
    setIsSubmitting(true);
    try {
      const createRes = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: params.fileName || 'contacts.csv',
          batchSize: params.batchSize,
          pauseMs: params.pauseMs,
          defaultCountry: params.defaultCountry,
          totalSourceRows: params.parsed.totalRows,
          duplicatesRemoved: params.parsed.duplicatesRemoved,
          invalidRows: params.parsed.invalidRows,
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

      const { job: created } = (await createRes.json()) as { job: PublicJobView };
      for (let i = 0; i < params.parsed.uniquePhones.length; i += UPLOAD_CHUNK_SIZE) {
        const chunkRes = await fetch(`/api/jobs/${created.id}/chunks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phones: params.parsed.uniquePhones.slice(i, i + UPLOAD_CHUNK_SIZE) }),
        });
        if (!chunkRes.ok) {
          const err = (await chunkRes.json().catch(() => ({}))) as { error?: string };
          setErrorText(err.error || 'Ошибка загрузки чанка номеров');
          return;
        }
      }

      const startRes = await fetch(`/api/jobs/${created.id}/start`, { method: 'POST' });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => ({}))) as { error?: string };
        setErrorText(err.error || 'Не удалось запустить проверку');
        return;
      }
      const { job: started } = (await startRes.json()) as { job: PublicJobView };
      syncUrlWithJob(started.id);
      setJob(started);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pauseJob = async () => {
    if (!job) return;
    actionEpochRef.current += 1;
    const res = await fetch(`/api/jobs/${job.id}/pause`, { method: 'POST' });
    if (res.ok) setJob(((await res.json()) as { job: PublicJobView }).job);
  };

  const resumeJob = async () => {
    if (!job) return;
    actionEpochRef.current += 1;
    setErrorText(null);
    const res = await fetch(`/api/jobs/${job.id}/resume`, { method: 'POST' });
    if (res.ok || res.status === 429) {
      const data = (await res.json()) as { job?: PublicJobView };
      if (data.job) setJob(data.job);
    }
  };

  const deleteJob = async () => {
    if (!job) return;
    actionEpochRef.current += 1;
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
    if (res.ok) {
      syncUrlWithJob(null);
      setJob(null);
    }
  };

  const changeFilter = (next: UiJobFilter) => {
    setFilter(next);
    if (job) void fetchJobFromServer(job.id, next);
  };

  return {
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
  };
}
