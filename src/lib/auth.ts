import crypto from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { ProviderMode } from '@/lib/types';

const OPERATOR_COOKIE_NAME = 'tgnaydi_operator';
const JOB_COOKIE_PREFIX = 'tgnaydi_job_';

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function getProviderMode(): ProviderMode {
  return process.env.PROVIDER_MODE === 'LIVE_MTPROTO' ? 'LIVE_MTPROTO' : 'SANDBOX';
}

export function generateSecretToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getJobCookieName(jobId: string): string {
  return `${JOB_COOKIE_PREFIX}${jobId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function setJobTokenCookie(res: NextResponse, jobId: string, rawToken: string): void {
  res.cookies.set(getJobCookieName(jobId), rawToken, cookieOptions(86_400));
}

export function extractJobToken(req: NextRequest, jobId: string): string | null {
  const headerToken = req.headers.get('x-job-token')?.trim();
  if (headerToken) return headerToken;
  const cookieToken = req.cookies.get(getJobCookieName(jobId))?.value.trim();
  return cookieToken || null;
}

export function verifyJobToken(expectedHash: string, rawToken: string | null): boolean {
  if (!rawToken) return false;
  return timingSafeEqualHex(expectedHash, hashSecret(rawToken));
}

export function setOperatorCookie(res: NextResponse, rawKey: string): void {
  res.cookies.set(OPERATOR_COOKIE_NAME, hashSecret(rawKey), cookieOptions(43_200));
}

export function verifyOperatorAccess(req: NextRequest): boolean {
  if (getProviderMode() !== 'LIVE_MTPROTO') return true;

  const configuredKey = process.env.OPERATOR_ACCESS_KEY?.trim();
  if (!configuredKey) return false;

  const expectedHash = hashSecret(configuredKey);
  const headerKey = req.headers.get('x-operator-key')?.trim();
  if (headerKey && timingSafeEqualHex(expectedHash, hashSecret(headerKey))) {
    return true;
  }

  const cookieHash = req.cookies.get(OPERATOR_COOKIE_NAME)?.value.trim();
  return Boolean(cookieHash && timingSafeEqualHex(expectedHash, cookieHash));
}
