import { createActivationHandler } from '@/lib/api-helpers';

export const POST = createActivationHandler({
  allowedFrom: ['paused', 'rate_limited'],
});
