#!/usr/bin/env tsx
/**
 * Standalone manual verification for HTTP response cache
 * Tests that repeated searches are cached and bypass rate limiter
 */

import { BlinkitHttpClient } from "./src/core/http-client.ts";
import { RateLimiter } from "./src/core/rate-limiter.ts";
import { Logger } from "./src/core/logger.ts";

console.log("=== Manual Cache Verification Test ===\n");
console.log("This test demonstrates cache behavior with timing measurements\n");

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch with call tracking
let fetchCallCount = 0;
const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  fetchCallCount++;
  return {
    ok: true,
    status: 200,
    json: async () => ({ products: ["milk", "bread"] }),
  } as Response;
};

// Replace global fetch
global.fetch = mockFetch as any;

async function runVerification() {
  try {
    // Create logger with debug level to see cache logs
    const logger = new Logger("debug");
    const rateLimiter = new RateLimiter();
    const httpClient = new BlinkitHttpClient(rateLimiter, logger);

    console.log("Test 1: First request (should hit network with rate limiter delay)");
    console.log("-".repeat(70));

    const start1 = Date.now();
    await httpClient.post("https://api.example.com/layout/search", { q: "milk" });
    const duration1 = Date.now() - start1;

    console.log(`✓ First request completed in ${duration1}ms`);
    console.log(`  - First request has no rate limiter delay (expected behavior)`);
    console.log(`  - Fetch was called: ${fetchCallCount} time(s)`);

    if (duration1 < 100) {
      console.log(`  ✓ First request completed without delay (${duration1}ms < 100ms)`);
    }

    console.log("\nTest 2: Second request (should be instant from cache)");
    console.log("-".repeat(70));

    const fetchCallsBefore = fetchCallCount;
    const start2 = Date.now();
    await httpClient.post("https://api.example.com/layout/search", { q: "milk" });
    const duration2 = Date.now() - start2;

    console.log(`✓ Second request completed in ${duration2}ms`);
    console.log(`  - Should be instant from cache (<10ms)`);
    console.log(`  - Fetch call count: ${fetchCallCount} (should still be ${fetchCallsBefore})`);

    if (duration2 < 10) {
      console.log(`  ✓ Cache hit confirmed! Instant response (${duration2}ms < 10ms)`);
    } else {
      console.log(`  ✗ WARNING: Second request took ${duration2}ms, expected < 10ms`);
    }

    if (fetchCallCount === fetchCallsBefore) {
      console.log(`  ✓ Network bypassed on cache hit (fetch not called again)`);
    } else {
      console.log(`  ✗ WARNING: Fetch was called again, expected no additional calls`);
    }

    console.log("\nTest 3: Different query (should hit network again)");
    console.log("-".repeat(70));

    const fetchCallsBefore2 = fetchCallCount;
    const start3 = Date.now();
    await httpClient.post("https://api.example.com/layout/search", { q: "bread" });
    const duration3 = Date.now() - start3;

    console.log(`✓ Different query completed in ${duration3}ms`);
    console.log(`  - Should hit network with rate limiter delay (~200ms)`);
    console.log(`  - Fetch call count: ${fetchCallCount} (should be ${fetchCallsBefore2 + 1})`);

    if (duration3 >= 195) {
      console.log(`  ✓ Rate limiter delay confirmed (${duration3}ms >= 195ms)`);
    }

    if (fetchCallCount === fetchCallsBefore2 + 1) {
      console.log(`  ✓ Cache key isolation working! Different query hit network`);
    }

    console.log("\nTest 4: Repeat different query (should be cached)");
    console.log("-".repeat(70));

    const fetchCallsBefore3 = fetchCallCount;
    const start4 = Date.now();
    await httpClient.post("https://api.example.com/layout/search", { q: "bread" });
    const duration4 = Date.now() - start4;

    console.log(`✓ Repeated different query completed in ${duration4}ms`);
    console.log(`  - Should be instant from cache (<10ms)`);
    console.log(`  - Fetch call count: ${fetchCallCount} (should still be ${fetchCallsBefore3})`);

    if (duration4 < 10) {
      console.log(`  ✓ Cache hit confirmed for second query!`);
    }

    if (fetchCallCount === fetchCallsBefore3) {
      console.log(`  ✓ Network bypassed on cache hit`);
    }

    console.log("\n" + "=".repeat(70));
    console.log("\n✅ VERIFICATION SUMMARY");
    console.log("=".repeat(70));

    const allTestsPassed =
      duration1 < 100 &&  // First request has no rate limiter delay
      duration2 < 10 &&   // Cached request is instant
      duration3 >= 195 && // Second network request has rate limiter delay (allow 5ms tolerance)
      duration4 < 10 &&   // Cached request is instant
      fetchCallCount === 2; // Only 2 network calls for 4 requests

    if (allTestsPassed) {
      console.log("\n✅ ALL TESTS PASSED!");
      console.log("\nCache behavior verified:");
      console.log("  ✓ First request completes without delay (no prior requests)");
      console.log("  ✓ Cached requests are instant (<10ms)");
      console.log("  ✓ Cache bypasses rate limiter (no delay on cache hits)");
      console.log("  ✓ Subsequent network requests have rate limiter delay (>200ms)");
      console.log("  ✓ Different queries have separate cache entries");
      console.log("  ✓ Network calls minimized (2 fetches for 4 requests)");
      console.log("\nDebug logs above show:");
      console.log('  - "HTTP POST ..." for network requests (Test 1, Test 3)');
      console.log('  - "Cache hit: POST ..." for cached requests (Test 2, Test 4)');
    } else {
      console.log("\n⚠ SOME TESTS DID NOT MEET EXPECTATIONS");
      console.log("\nActual results:");
      console.log(`  - First request duration: ${duration1}ms (expected < 100ms)`);
      console.log(`  - Second request duration: ${duration2}ms (expected < 10ms)`);
      console.log(`  - Third request duration: ${duration3}ms (expected >= 195ms)`);
      console.log(`  - Fourth request duration: ${duration4}ms (expected < 10ms)`);
      console.log(`  - Total fetch calls: ${fetchCallCount} (expected 2)`);
    }

    console.log("\n" + "=".repeat(70));

    return allTestsPassed;
  } finally {
    // Restore original fetch
    global.fetch = originalFetch;
  }
}

// Run the verification
runVerification()
  .then((passed) => {
    if (passed) {
      console.log("\n✅ Manual verification completed successfully!");
      console.log("\nThe cache is working as expected:");
      console.log("  • Repeated searches are cached");
      console.log("  • Cache hits bypass the rate limiter");
      console.log("  • Instant response on cache hits");
      process.exit(0);
    } else {
      console.log("\n❌ Verification did not pass all expectations");
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("\n❌ Verification failed with error:", error);
    process.exit(1);
  });
