import { expect, it, vi } from 'vitest';
import { withRetry, withTimeout } from '../src/utils/error-handler.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';

it('retries a temporary error and times out a pending operation', async () => {
  let attempts = 0;
  await expect(withRetry(async () => {
    if (++attempts === 1) throw new Error('Temporary error');
    return 42;
  }, 1, 0)).resolves.toBe(42);
  await expect(withTimeout(() => new Promise(() => {}), 5)).rejects.toMatchObject({ code: 'AGENT_TIMEOUT' });
});

it('stops after three attempts by default', async () => {
  vi.useFakeTimers();
  try {
    const operation = vi.fn(async () => { throw new Error('Persistent error'); });
    const failure = expect(withRetry(operation)).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
    await vi.runAllTimersAsync();
    await failure;
    expect(operation).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it('waits for a slot and counts requests and tokens', async () => {
  const limiter = new RateLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 2, maxTokensPerMinute: 100 });
  await limiter.acquire(40);
  const waiting = limiter.acquire(60);
  expect(limiter.getStatus()).toMatchObject({ activeRequests: 1, requestsInWindow: 1, tokensInWindow: 40 });
  limiter.release();
  await waiting;
  expect(limiter.getStatus()).toMatchObject({ activeRequests: 1, requestsInWindow: 2, tokensInWindow: 100 });
  limiter.release();
  expect(limiter.canProceed(1)).toBe(false);
});
