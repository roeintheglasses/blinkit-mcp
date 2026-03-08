export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxJitter?: number;
  retryableErrors?: (error: unknown) => boolean;
}

export interface RetryContext {
  attempt: number;
  lastError: unknown;
  nextDelay: number;
}

export type RetryCallback = (context: RetryContext) => void;

/**
 * RetryManager handles exponential backoff with jitter for retrying operations.
 *
 * Delay formula: (baseDelay * 2^attempt) + random(0, maxJitter)
 *
 * Example:
 *   const manager = new RetryManager({ maxRetries: 3, baseDelay: 1000 });
 *   const result = await manager.retry(() => fetchData());
 */
export class RetryManager {
  private readonly maxRetries: number;
  private readonly baseDelay: number;
  private readonly maxJitter: number;
  private readonly retryableErrors: (error: unknown) => boolean;

  constructor(config: RetryConfig) {
    this.maxRetries = config.maxRetries;
    this.baseDelay = config.baseDelay;
    this.maxJitter = config.maxJitter ?? 500;
    this.retryableErrors = config.retryableErrors ?? (() => true);
  }

  /**
   * Retry an operation with exponential backoff and jitter.
   *
   * @param operation - Async function to retry
   * @param onRetry - Optional callback invoked before each retry attempt
   * @returns Result of the operation
   * @throws Last error if all retries are exhausted
   */
  async retry<T>(
    operation: () => Promise<T>,
    onRetry?: RetryCallback
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't retry if this is the last attempt or error is not retryable
        if (attempt >= this.maxRetries || !this.retryableErrors(error)) {
          throw error;
        }

        const delay = this.calculateDelay(attempt);

        if (onRetry) {
          onRetry({
            attempt: attempt + 1,
            lastError: error,
            nextDelay: delay,
          });
        }

        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript doesn't know that
    throw lastError;
  }

  /**
   * Calculate exponential backoff delay with jitter.
   *
   * Formula: (baseDelay * 2^attempt) + random(0, maxJitter)
   */
  private calculateDelay(attempt: number): number {
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * this.maxJitter;
    return exponentialDelay + jitter;
  }

  /**
   * Sleep for the specified number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<RetryConfig> {
    return {
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay,
      maxJitter: this.maxJitter,
      retryableErrors: this.retryableErrors,
    };
  }
}

/**
 * Helper function to determine if an HTTP error should be retried.
 *
 * Retries on:
 * - Network errors (no response)
 * - 5xx server errors
 * - Timeouts
 *
 * Does NOT retry on:
 * - 4xx client errors
 * - Authentication failures
 */
export function isRetryableHttpError(error: unknown): boolean {
  // Network errors (no response received)
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("fetch failed")
    ) {
      return true;
    }
  }

  // HTTP response errors
  if (typeof error === "object" && error !== null) {
    const err = error as { status?: number; statusCode?: number };
    const status = err.status ?? err.statusCode;

    if (status !== undefined) {
      // Retry 5xx server errors
      if (status >= 500 && status < 600) {
        return true;
      }

      // Retry 429 Too Many Requests
      if (status === 429) {
        return true;
      }

      // Don't retry 4xx client errors (except 429)
      if (status >= 400 && status < 500) {
        return false;
      }
    }
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Helper function to determine if a Playwright error should be retried.
 *
 * Retries on:
 * - Selector timeouts
 * - Navigation timeouts
 * - Network errors
 *
 * Does NOT retry on:
 * - Target closed errors (browser/page closed)
 */
export function isRetryablePlaywrightError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Retry timeouts
    if (
      message.includes("timeout") ||
      message.includes("waiting for selector") ||
      message.includes("navigation timeout")
    ) {
      return true;
    }

    // Don't retry if browser/page was closed
    if (
      message.includes("target closed") ||
      message.includes("browser has been closed") ||
      message.includes("page has been closed")
    ) {
      return false;
    }

    // Retry network errors
    if (
      message.includes("network") ||
      message.includes("net::err")
    ) {
      return true;
    }
  }

  // Default: don't retry unknown errors
  return false;
}
