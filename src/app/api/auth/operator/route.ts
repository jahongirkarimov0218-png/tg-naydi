import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashSecret, setOperatorCookie, timingSafeEqualHex } from '@/lib/auth';

const OperatorAuthSchema = z.object({
  key: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const configured = process.env.OPERATOR_ACCESS_KEY?.trim();
  if (!configured) {
    return NextResponse.json(
      { error: 'OPERATOR_ACCESS_KEY is not configured on the server.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = OperatorAuthSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Operator key is required' }, { status: 400 });
  }

  if (!timingSafeEqualHex(hashSecret(configured), hashSecret(parsed.data.key.trim()))) {
    return NextResponse.json({ error: 'Invalid operator key' }, { status: 401 });
  }

  const res = NextResponse.json({ authenticated: true });
  setOperatorCookie(res, parsed.data.key.trim());
  return res;
}
