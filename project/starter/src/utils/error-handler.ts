/**
 * Custom error class for review operations
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ReviewError';
    Error.captureStackTrace(this, ReviewError);
  }
}

/**
 * Error codes for the review system
 */
export const ErrorCodes = {
  // Configuration errors
  MISSING_API_KEY: 'MISSING_API_KEY',
  MISSING_GITHUB_TOKEN: 'MISSING_GITHUB_TOKEN',
  INVALID_CONFIG: 'INVALID_CONFIG',

  // GitHub errors
  PR_NOT_FOUND: 'PR_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // Agent errors
  AGENT_TIMEOUT: 'AGENT_TIMEOUT',
  AGENT_FAILED: 'AGENT_FAILED',
  STRUCTURED_OUTPUT_FAILED: 'STRUCTURED_OUTPUT_FAILED',

  // General errors
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Retry utility with exponential backoff
 *
 * Exponential backoff uses delayMs * 2 ** attempt because the loop starts at
 * zero. The first retry waits one base delay, the second waits twice that,
 * and each subsequent base delay doubles.
 *
 * Jitter adds a random delay from 0 up to 100 ms so clients that failed at
 * the same time are less likely to retry together and overload the service.
 *
 * Wrap setTimeout in a Promise and pass resolve as its callback.
 * Awaiting that Promise pauses the retry loop until the timer fires.
 * A successful call returns immediately. Exhausted retries throw a
 * ReviewError with ErrorCodes.RETRY_EXHAUSTED.
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum retries after the initial attempt (default: 2, for 3 attempts total)
 * @param delayMs - Base delay in milliseconds (default: 1000)
 * @returns The result of the successful function execution
 * @throws ReviewError with RETRY_EXHAUSTED code if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 1000
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw new ReviewError(formatError(error), ErrorCodes.RETRY_EXHAUSTED, { cause: error });
      }
      const wait = delayMs * 2 ** attempt + Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}

/**
 * Wrap an async function with timeout
 *
 * Promise.race adopts the outcome of the first Promise to settle, whether
 * it fulfills or rejects. It does not cancel the other operation.
 *
 * Create a Promise whose setTimeout callback calls reject after timeoutMs.
 * Reject with a ReviewError using ErrorCodes.AGENT_TIMEOUT and include
 * timeoutMs in its metadata. Clear the timer once the race settles.
 *
 *
 * @param fn - Async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Custom error message
 * @returns The result of the function if it completes before timeout
 * @throws ReviewError with AGENT_TIMEOUT code if timeout is reached
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(
          new ReviewError(errorMessage, ErrorCodes.AGENT_TIMEOUT, { timeoutMs })
        ), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if an error is a ReviewError
 */
export function isReviewError(error: unknown): error is ReviewError {
  return error instanceof ReviewError;
}

/**
 * Format error for logging/display
 */
export function formatError(error: unknown): string {
  if (isReviewError(error)) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
