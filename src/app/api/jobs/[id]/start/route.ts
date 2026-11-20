import { createActivationHandler } from '@/lib/api-helpers';

export const POST = createActivationHandler({
  allowedFrom: ['draft', 'paused', 'rate_limited'],
  requireItems: true,
});
