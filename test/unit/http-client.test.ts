import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { BlinkitHttpClient } from "../../src/core/http-client.ts";
import { RateLimiter } from "../../src/core/rate-limiter.ts";
import { Logger } from "../../src/core/logger.ts";

// Mock fetch globally
const originalFetch = global.fetch;

describe("BlinkitHttpClient - Cache Integration", () => {
  let client: BlinkitHttpClient;
  let rateLimiter: RateLimiter;
  let logger: Logger;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create fast rate limiter for tests (no delays)
    rateLimiter = new RateLimiter(100, 1000, 0);
    logger = new Logger("error"); // Quiet logger for tests
    client = new BlinkitHttpClient(rateLimiter, logger);

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  test("caches GET requests", async () => {
    const mockResponse = { products: ["milk", "bread"] };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // First request - should hit network
    const result1 = await client.get("https://blinkit.com/v2/categories");
    expect(result1.data).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second request - should hit cache
    const result2 = await client.get("https://blinkit.com/v2/categories");
    expect(result2.data).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch
  });

  test("caches POST requests to search endpoint", async () => {
    const searchBody = { query: "milk" };
    const mockResponse = { results: [{ name: "Milk 1L" }] };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // First search - should hit network
    const result1 = await client.post(
      "https://blinkit.com/v1/layout/search",
      searchBody
    );
    expect(result1.data).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same search - should hit cache
    const result2 = await client.post(
      "https://blinkit.com/v1/layout/search",
      searchBody
    );
    expect(result2.data).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch
  });

  test("does not cache non-search POST requests", async () => {
    const mockResponse = { success: true };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // First request
    await client.post("https://blinkit.com/v1/cart/add", { productId: "123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second identical request - should NOT hit cache
    await client.post("https://blinkit.com/v1/cart/add", { productId: "123" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // Fresh fetch
  });

  test("does not cache failed responses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    // First request - fails
    const result1 = await client.get("https://blinkit.com/v2/categories");
    expect(result1.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second request - should hit network again (not cached)
    const result2 = await client.get("https://blinkit.com/v2/categories");
    expect(result2.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("different request bodies create different cache keys", async () => {
    const mockResponse1 = { results: [{ name: "Milk" }] };
    const mockResponse2 = { results: [{ name: "Bread" }] };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse1,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse2,
      });

    // Search for "milk"
    const result1 = await client.post(
      "https://blinkit.com/v1/layout/search",
      { query: "milk" }
    );
    expect(result1.data).toEqual(mockResponse1);

    // Search for "bread" - different body, should hit network
    const result2 = await client.post(
      "https://blinkit.com/v1/layout/search",
      { query: "bread" }
    );
    expect(result2.data).toEqual(mockResponse2);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Repeat "milk" search - should hit cache
    const result3 = await client.post(
      "https://blinkit.com/v1/layout/search",
      { query: "milk" }
    );
    expect(result3.data).toEqual(mockResponse1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // No additional fetch
  });

  test("cache expires after TTL", async () => {
    const mockResponse = { products: ["milk"] };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // Create client with very short TTL (100ms)
    const shortTtlClient = new BlinkitHttpClient(rateLimiter, logger);
    // Access private cache to set short TTL for testing
    (shortTtlClient as any).cache = new (await import("../../src/core/http-cache.ts")).HttpCache(100);

    // First request
    await shortTtlClient.get("https://blinkit.com/v2/categories");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Immediate second request - should hit cache
    await shortTtlClient.get("https://blinkit.com/v2/categories");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    // Request after TTL - should hit network again
    await shortTtlClient.get("https://blinkit.com/v2/categories");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("cache hit bypasses rate limiter delay", async () => {
    // Create slow rate limiter (200ms minimum interval)
    const slowRateLimiter = new RateLimiter(10, 10, 200);
    const slowClient = new BlinkitHttpClient(slowRateLimiter, logger);

    const mockResponse = { products: ["milk"] };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // First request - will have rate limiter delay
    await slowClient.get("https://blinkit.com/v2/categories");

    // Second request (cached) - should be nearly instant
    const start = Date.now();
    await slowClient.get("https://blinkit.com/v2/categories");
    const elapsed = Date.now() - start;

    // Cache hit should be fast (< 50ms), bypassing the 200ms rate limit
    expect(elapsed).toBeLessThan(50);
  });

  test("handles request with no body", async () => {
    const mockResponse = { data: "test" };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    // POST without body
    await client.post("https://blinkit.com/v1/layout/search");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same POST without body - should hit cache
    await client.post("https://blinkit.com/v1/layout/search");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("different URLs create different cache entries", async () => {
    const mockResponse1 = { category: "dairy" };
    const mockResponse2 = { category: "bakery" };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse1,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse2,
      });

    // Request to category 1
    const result1 = await client.get("https://blinkit.com/v6/category/products/1");
    expect(result1.data).toEqual(mockResponse1);

    // Request to category 2 - different URL
    const result2 = await client.get("https://blinkit.com/v6/category/products/2");
    expect(result2.data).toEqual(mockResponse2);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Repeat category 1 - should hit cache
    const result3 = await client.get("https://blinkit.com/v6/category/products/1");
    expect(result3.data).toEqual(mockResponse1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
