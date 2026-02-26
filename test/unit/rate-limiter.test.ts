import { describe, test, expect } from "vitest";
import { RateLimiter } from "../../src/core/rate-limiter.ts";

describe("RateLimiter", () => {
  test("allows burst up to capacity", async () => {
    const limiter = new RateLimiter(3, 10, 0); // capacity=3, fast refill, no min interval
    const start = Date.now();

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    const elapsed = Date.now() - start;
    // All 3 should be nearly instant (within capacity)
    expect(elapsed).toBeLessThan(100);
  });

  test("enforces minimum interval", async () => {
    const limiter = new RateLimiter(10, 10, 100); // min 100ms between requests
    await limiter.acquire();

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90); // allow small timing variance
  });

  test("waits when tokens depleted", async () => {
    const limiter = new RateLimiter(1, 5, 0); // capacity=1, 5 tokens/sec, no min interval
    await limiter.acquire(); // use the 1 token

    const start = Date.now();
    await limiter.acquire(); // should wait for refill
    const elapsed = Date.now() - start;

    // Should wait ~200ms for 1 token at 5/sec rate
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  test("refills over time", async () => {
    const limiter = new RateLimiter(2, 10, 0); // capacity=2, 10 tokens/sec
    await limiter.acquire();
    await limiter.acquire();

    // Wait 200ms — should refill ~2 tokens at 10/sec
    await new Promise((r) => setTimeout(r, 200));

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
