import { describe, test, expect, vi } from "vitest";
import { RetryManager, isRetryableHttpError, isRetryablePlaywrightError } from "./retry-manager.ts";

describe("RetryManager", () => {
  test("should instantiate with config", () => {
    const rm = new RetryManager({ maxRetries: 3, baseDelay: 1000 });
    expect(rm).toBeDefined();
    expect(rm.getConfig().maxRetries).toBe(3);
    expect(rm.getConfig().baseDelay).toBe(1000);
  });

  test("should succeed on first try", async () => {
    const rm = new RetryManager({ maxRetries: 3, baseDelay: 100 });
    const operation = vi.fn().mockResolvedValue("success");

    const result = await rm.retry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  test("should retry on failure and eventually succeed", async () => {
    const rm = new RetryManager({ maxRetries: 3, baseDelay: 10 });
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("success");

    const result = await rm.retry(operation);

    expect(result).toBe("success");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  test("should throw after exhausting retries", async () => {
    const rm = new RetryManager({ maxRetries: 2, baseDelay: 10 });
    const error = new Error("persistent failure");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(rm.retry(operation)).rejects.toThrow("persistent failure");
    expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test("should call onRetry callback", async () => {
    const rm = new RetryManager({ maxRetries: 2, baseDelay: 10 });
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");
    const onRetry = vi.fn();

    await rm.retry(operation, onRetry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      lastError: expect.any(Error),
      nextDelay: expect.any(Number),
    });
  });

  test("should apply exponential backoff with jitter", async () => {
    const rm = new RetryManager({ maxRetries: 2, baseDelay: 100, maxJitter: 50 });
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("success");
    const delays: number[] = [];

    await rm.retry(operation, (ctx) => {
      delays.push(ctx.nextDelay);
    });

    expect(delays.length).toBe(1);
    // First delay should be baseDelay (100) + jitter (0-50)
    expect(delays[0]).toBeGreaterThanOrEqual(100);
    expect(delays[0]).toBeLessThan(150);
  });

  test("should not retry if retryableErrors returns false", async () => {
    const rm = new RetryManager({
      maxRetries: 3,
      baseDelay: 10,
      retryableErrors: () => false,
    });
    const error = new Error("non-retryable");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(rm.retry(operation)).rejects.toThrow("non-retryable");
    expect(operation).toHaveBeenCalledTimes(1); // no retries
  });
});

describe("isRetryableHttpError", () => {
  test("should retry 5xx errors", () => {
    expect(isRetryableHttpError({ status: 500 })).toBe(true);
    expect(isRetryableHttpError({ status: 502 })).toBe(true);
    expect(isRetryableHttpError({ status: 503 })).toBe(true);
  });

  test("should retry 429 Too Many Requests", () => {
    expect(isRetryableHttpError({ status: 429 })).toBe(true);
  });

  test("should not retry 4xx client errors", () => {
    expect(isRetryableHttpError({ status: 400 })).toBe(false);
    expect(isRetryableHttpError({ status: 401 })).toBe(false);
    expect(isRetryableHttpError({ status: 404 })).toBe(false);
  });

  test("should retry network errors", () => {
    expect(isRetryableHttpError(new Error("timeout occurred"))).toBe(true);
    expect(isRetryableHttpError(new Error("network error"))).toBe(true);
    expect(isRetryableHttpError(new Error("ECONNRESET"))).toBe(true);
  });
});

describe("isRetryablePlaywrightError", () => {
  test("should retry timeout errors", () => {
    expect(isRetryablePlaywrightError(new Error("Timeout waiting for selector"))).toBe(true);
    expect(isRetryablePlaywrightError(new Error("Navigation timeout"))).toBe(true);
  });

  test("should not retry target closed errors", () => {
    expect(isRetryablePlaywrightError(new Error("Target closed"))).toBe(false);
    expect(isRetryablePlaywrightError(new Error("Browser has been closed"))).toBe(false);
  });

  test("should retry network errors", () => {
    expect(isRetryablePlaywrightError(new Error("net::ERR_CONNECTION_RESET"))).toBe(true);
  });
});
