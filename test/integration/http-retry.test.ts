import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { BlinkitHttpClient } from "../../src/core/http-client.ts";
import { RateLimiter } from "../../src/core/rate-limiter.ts";
import { Logger } from "../../src/core/logger.ts";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("HTTP Client with Retry Integration", () => {
  let httpClient: BlinkitHttpClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    // Create client with fast rate limiter for testing
    const rateLimiter = new RateLimiter(10, 100, 0); // high capacity, no min interval
    const logger = new Logger("error"); // suppress logs during tests
    const config = ConfigSchema.parse({}); // Use default config values
    httpClient = new BlinkitHttpClient(rateLimiter, logger, config);

    // Save original fetch
    originalFetch = global.fetch;
  });

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("should retry on 500 errors and eventually succeed", async () => {
    let attemptCount = 0;
    const mockData = { result: "success" };

    // Mock fetch to fail twice with 500, then succeed
    global.fetch = vi.fn(async () => {
      attemptCount++;
      if (attemptCount < 3) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal Server Error" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/test");

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(mockData);
    expect(attemptCount).toBe(3); // 2 failures + 1 success
  });

  test("should retry on 502 Bad Gateway and eventually succeed", async () => {
    let attemptCount = 0;
    const mockData = { items: [1, 2, 3] };

    global.fetch = vi.fn(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: "Bad Gateway" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/items");

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(mockData);
    expect(attemptCount).toBe(2); // 1 failure + 1 success
  });

  test("should retry on 503 Service Unavailable and eventually succeed", async () => {
    let attemptCount = 0;
    const mockData = { status: "ok" };

    global.fetch = vi.fn(async () => {
      attemptCount++;
      if (attemptCount <= 2) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "Service Unavailable" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => mockData,
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/status");

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(mockData);
    expect(attemptCount).toBe(3);
  });

  test("should fail after exhausting all retries on persistent 500 errors", async () => {
    let attemptCount = 0;

    // Always return 500
    global.fetch = vi.fn(async () => {
      attemptCount++;
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: "Persistent Server Error" }),
      } as Response;
    });

    await expect(
      httpClient.get("https://example.com/api/broken")
    ).rejects.toThrow("HTTP GET request to https://example.com/api/broken failed with status 500");

    // Should attempt: 1 initial + 3 retries = 4 total attempts
    expect(attemptCount).toBe(4);
  }, 10000); // 10 second timeout for retry delays

  test("should not retry on 4xx client errors", async () => {
    let attemptCount = 0;

    global.fetch = vi.fn(async () => {
      attemptCount++;
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: "Not Found" }),
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/notfound");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(attemptCount).toBe(1); // No retries for 4xx errors
  });

  test("should not retry on 401 unauthorized errors", async () => {
    let attemptCount = 0;

    global.fetch = vi.fn(async () => {
      attemptCount++;
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/protected");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(attemptCount).toBe(1); // No retries for auth errors
  });

  test("should handle POST requests with retry on transient failures", async () => {
    let attemptCount = 0;
    const requestBody = { name: "test", value: 123 };
    const mockResponse = { id: 456, created: true };

    global.fetch = vi.fn(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "Service Unavailable" }),
        } as Response;
      }
      return {
        ok: true,
        status: 201,
        json: async () => mockResponse,
      } as Response;
    });

    const result = await httpClient.post(
      "https://example.com/api/create",
      requestBody
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.data).toEqual(mockResponse);
    expect(attemptCount).toBe(2);
  });

  test("should apply exponential backoff between retries", async () => {
    let attemptCount = 0;
    const attemptTimes: number[] = [];

    global.fetch = vi.fn(async () => {
      attemptCount++;
      attemptTimes.push(Date.now());

      if (attemptCount < 4) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Server Error" }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    });

    const start = Date.now();
    await httpClient.get("https://example.com/api/test");
    const elapsed = Date.now() - start;

    expect(attemptCount).toBe(4); // 1 initial + 3 retries
    expect(attemptTimes).toHaveLength(4);

    // First retry should wait ~1000ms (baseDelay)
    const delay1 = attemptTimes[1] - attemptTimes[0];
    expect(delay1).toBeGreaterThanOrEqual(900); // Allow timing variance
    expect(delay1).toBeLessThan(2000); // baseDelay + maxJitter

    // Second retry should wait ~2000ms (baseDelay * 2)
    const delay2 = attemptTimes[2] - attemptTimes[1];
    expect(delay2).toBeGreaterThanOrEqual(1800); // Allow timing variance
    expect(delay2).toBeLessThan(3000); // (baseDelay * 2) + maxJitter

    // Third retry should wait ~4000ms (baseDelay * 4)
    const delay3 = attemptTimes[3] - attemptTimes[2];
    expect(delay3).toBeGreaterThanOrEqual(3600); // Allow timing variance
    expect(delay3).toBeLessThan(5000); // (baseDelay * 4) + maxJitter

    // Total time should be at least ~7000ms (1s + 2s + 4s)
    expect(elapsed).toBeGreaterThanOrEqual(6500);
  }, 10000); // 10 second timeout for exponential backoff

  test("should handle mixed transient and permanent failures", async () => {
    let attemptCount = 0;

    global.fetch = vi.fn(async () => {
      attemptCount++;

      // First attempt: 503 (retryable)
      if (attemptCount === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "Service Unavailable" }),
        } as Response;
      }

      // Second attempt: 500 (retryable)
      if (attemptCount === 2) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Internal Server Error" }),
        } as Response;
      }

      // Third attempt: success
      return {
        ok: true,
        status: 200,
        json: async () => ({ recovered: true }),
      } as Response;
    });

    const result = await httpClient.get("https://example.com/api/flaky");

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ recovered: true });
    expect(attemptCount).toBe(3);
  });

  test("should work with custom headers on retry", async () => {
    let attemptCount = 0;
    const customHeaders = { "X-Custom-Header": "test-value" };

    global.fetch = vi.fn(async (url, options) => {
      attemptCount++;

      // Verify custom headers are preserved across retries
      expect(options?.headers).toMatchObject(customHeaders);

      if (attemptCount === 1) {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: "Bad Gateway" }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response;
    });

    const result = await httpClient.get(
      "https://example.com/api/test",
      customHeaders
    );

    expect(result.ok).toBe(true);
    expect(attemptCount).toBe(2);
  });
});
