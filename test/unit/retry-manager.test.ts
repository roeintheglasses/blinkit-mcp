import { describe, test, expect } from "vitest";
import {
  RetryManager,
  isRetryableHttpError,
  isRetryablePlaywrightError,
} from "../../src/core/retry-manager.ts";

describe("RetryManager", () => {
  test("should succeed on first attempt without retrying", async () => {
    const manager = new RetryManager({ maxRetries: 3, baseDelay: 100 });
    let attempts = 0;

    const result = await manager.retry(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  test("should retry on failure and eventually succeed", async () => {
    const manager = new RetryManager({ maxRetries: 3, baseDelay: 50 });
    let attempts = 0;

    const result = await manager.retry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("temporary failure");
      }
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  test("should throw final error after exhausting all retries", async () => {
    const manager = new RetryManager({ maxRetries: 2, baseDelay: 50 });
    let attempts = 0;

    await expect(
      manager.retry(async () => {
        attempts++;
        throw new Error(`failure ${attempts}`);
      })
    ).rejects.toThrow("failure 3");

    expect(attempts).toBe(3); // initial + 2 retries
  });

  test("should apply exponential backoff delays", async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      baseDelay: 100,
      maxJitter: 0, // No jitter for predictable timing
    });
    let attempts = 0;
    const delays: number[] = [];
    let lastTime = Date.now();

    try {
      await manager.retry(async () => {
        attempts++;
        if (attempts > 1) {
          const elapsed = Date.now() - lastTime;
          delays.push(elapsed);
        }
        lastTime = Date.now();
        throw new Error("fail");
      });
    } catch {
      // Expected to fail
    }

    expect(attempts).toBe(4); // initial + 3 retries
    expect(delays).toHaveLength(3);

    // Verify exponential backoff: 100ms, 200ms, 400ms (with timing variance)
    expect(delays[0]).toBeGreaterThanOrEqual(90); // ~100ms
    expect(delays[0]).toBeLessThan(150);
    expect(delays[1]).toBeGreaterThanOrEqual(180); // ~200ms
    expect(delays[1]).toBeLessThan(250);
    expect(delays[2]).toBeGreaterThanOrEqual(360); // ~400ms
    expect(delays[2]).toBeLessThan(500);
  });

  test("should add jitter to delays", async () => {
    const manager = new RetryManager({
      maxRetries: 2,
      baseDelay: 100,
      maxJitter: 50,
    });
    let attempts = 0;
    const delays: number[] = [];
    let lastTime = Date.now();

    try {
      await manager.retry(async () => {
        attempts++;
        if (attempts > 1) {
          const elapsed = Date.now() - lastTime;
          delays.push(elapsed);
        }
        lastTime = Date.now();
        throw new Error("fail");
      });
    } catch {
      // Expected to fail
    }

    expect(delays).toHaveLength(2);
    // Delays should be baseDelay * 2^attempt + jitter (0-50ms)
    // First retry: 100ms + jitter
    expect(delays[0]).toBeGreaterThanOrEqual(90);
    expect(delays[0]).toBeLessThan(160); // 100 + 50 + variance
    // Second retry: 200ms + jitter
    expect(delays[1]).toBeGreaterThanOrEqual(180);
    expect(delays[1]).toBeLessThan(260); // 200 + 50 + variance
  });

  test("should invoke onRetry callback with correct context", async () => {
    const manager = new RetryManager({ maxRetries: 2, baseDelay: 50 });
    const callbacks: Array<{
      attempt: number;
      lastError: unknown;
      nextDelay: number;
    }> = [];

    try {
      await manager.retry(
        async () => {
          throw new Error("fail");
        },
        (context) => {
          callbacks.push({ ...context });
        }
      );
    } catch {
      // Expected to fail
    }

    expect(callbacks).toHaveLength(2); // 2 retries

    // First retry
    expect(callbacks[0].attempt).toBe(1);
    expect((callbacks[0].lastError as Error).message).toBe("fail");
    expect(callbacks[0].nextDelay).toBeGreaterThan(0);

    // Second retry
    expect(callbacks[1].attempt).toBe(2);
    expect((callbacks[1].lastError as Error).message).toBe("fail");
    expect(callbacks[1].nextDelay).toBeGreaterThan(0);
  });

  test("should respect custom retryableErrors filter", async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      baseDelay: 50,
      retryableErrors: (error) => {
        if (error instanceof Error) {
          return error.message.includes("retryable");
        }
        return false;
      },
    });
    let attempts = 0;

    // Non-retryable error should not retry
    await expect(
      manager.retry(async () => {
        attempts++;
        throw new Error("permanent failure");
      })
    ).rejects.toThrow("permanent failure");

    expect(attempts).toBe(1); // No retries

    // Retryable error should retry
    attempts = 0;
    try {
      await manager.retry(async () => {
        attempts++;
        throw new Error("retryable failure");
      });
    } catch {
      // Expected to fail
    }

    expect(attempts).toBe(4); // initial + 3 retries
  });

  test("should return config values", () => {
    const manager = new RetryManager({
      maxRetries: 5,
      baseDelay: 200,
      maxJitter: 100,
    });

    const config = manager.getConfig();
    expect(config.maxRetries).toBe(5);
    expect(config.baseDelay).toBe(200);
    expect(config.maxJitter).toBe(100);
    expect(config.retryableErrors).toBeDefined();
  });

  test("should use default maxJitter if not provided", () => {
    const manager = new RetryManager({ maxRetries: 3, baseDelay: 100 });
    const config = manager.getConfig();
    expect(config.maxJitter).toBe(500); // default value
  });
});

describe("isRetryableHttpError", () => {
  test("should retry on 5xx server errors", () => {
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ status: 502 })).toBe(true);
    expect(isRetryableHttpError({ status: 503 })).toBe(true);
    expect(isRetryableHttpError({ statusCode: 504 })).toBe(true);
  });

  test("should retry on 429 Too Many Requests", () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
  });

  test("should not retry on 4xx client errors (except 429)", () => {
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
    expect(isRetryableHttpError({ status: 401 })).toBe(false);
    expect(isRetryableHttpError({ status: 403 })).toBe(false);
    expect(isRetryableHttpError({ status: 404 })).toBe(false);
  });

  test("should retry on network errors", () => {
    expect(isRetryableHttpError(new Error("Network request failed"))).toBe(
      true
    );
    expect(isRetryableHttpError(new Error("timeout exceeded"))).toBe(true);
    expect(isRetryableHttpError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableHttpError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isRetryableHttpError(new Error("fetch failed"))).toBe(true);
  });

  test("should not retry on unknown errors", () => {
    expect(isRetryableHttpError(new Error("something went wrong"))).toBe(
      false
    );
    expect(isRetryableHttpError({ message: "unknown" })).toBe(false);
    expect(isRetryableHttpError("string error")).toBe(false);
  });
});

describe("isRetryablePlaywrightError", () => {
  test("should retry on timeout errors", () => {
    expect(isRetryablePlaywrightError(new Error("Timeout 30000ms exceeded"))).toBe(
      true
    );
    expect(
      isRetryablePlaywrightError(new Error("waiting for selector timeout"))
    ).toBe(true);
    expect(isRetryablePlaywrightError(new Error("Navigation timeout"))).toBe(
      true
    );
  });

  test("should retry on network errors", () => {
    expect(
      isRetryablePlaywrightError(new Error("net::ERR_CONNECTION_REFUSED"))
    ).toBe(true);
    expect(isRetryablePlaywrightError(new Error("Network error occurred"))).toBe(
      true
    );
  });

  test("should not retry on target closed errors", () => {
    expect(
      isRetryablePlaywrightError(new Error("Target page, context or browser has been closed"))
    ).toBe(false);
    expect(
      isRetryablePlaywrightError(new Error("Browser has been closed"))
    ).toBe(false);
    expect(isRetryablePlaywrightError(new Error("Page has been closed"))).toBe(
      false
    );
  });

  test("should not retry on unknown errors", () => {
    expect(isRetryablePlaywrightError(new Error("something went wrong"))).toBe(
      false
    );
    expect(isRetryablePlaywrightError("string error")).toBe(false);
  });
});
