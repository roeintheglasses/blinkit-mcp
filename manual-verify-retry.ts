/**
 * Manual verification script for retry and circuit breaker behavior.
 *
 * This script:
 * 1. Sets up a local HTTP server that can return 5xx errors on demand
 * 2. Tests retry logs (attempt number, delay, error)
 * 3. Tests circuit breaker opens after 5 failures
 * 4. Tests circuit breaker closes after 30s timeout
 */

import { createServer } from "node:http";
import { BlinkitHttpClient } from "./src/core/http-client.ts";
import { RateLimiter } from "./src/core/rate-limiter.ts";
import { Logger } from "./src/core/logger.ts";

// Create test HTTP server
let requestCount = 0;
let shouldFail = false;
let failureMode: "500" | "503" | "timeout" = "500";

const server = createServer((req, res) => {
  requestCount++;
  console.log(`\n[TEST SERVER] Request ${requestCount} received`);

  if (shouldFail) {
    if (failureMode === "timeout") {
      console.log(`[TEST SERVER] Simulating timeout (not responding)`);
      // Don't respond - let it timeout
      return;
    }

    const statusCode = failureMode === "500" ? 500 : 503;
    console.log(`[TEST SERVER] Returning ${statusCode} error`);
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Server error ${statusCode}` }));
    return;
  }

  console.log(`[TEST SERVER] Returning 200 OK`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, message: "OK" }));
});

const PORT = 8765;
server.listen(PORT);

console.log(`\n=== MANUAL VERIFICATION: Retry & Circuit Breaker ===\n`);
console.log(`Test server started on http://localhost:${PORT}\n`);

// Create HTTP client with logger that outputs to console
const logger = new Logger("info");
const rateLimiter = new RateLimiter({ requestsPerSecond: 100 });
const httpClient = new BlinkitHttpClient(rateLimiter, logger);

const testUrl = `http://localhost:${PORT}/test`;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Verify retry logs with 5xx errors");
  console.log("=".repeat(60));
  console.log("\nExpected: Should retry 3 times with exponential backoff");
  console.log("- Attempt 1/3 after ~1000ms delay");
  console.log("- Attempt 2/3 after ~2000ms delay");
  console.log("- Attempt 3/3 after ~4000ms delay");
  console.log("- All with 0-500ms jitter added\n");

  requestCount = 0;
  shouldFail = true;
  failureMode = "503";

  try {
    await httpClient.get(testUrl);
    console.log("\n❌ FAIL: Should have thrown error after exhausting retries");
  } catch (error) {
    console.log("\n✅ PASS: Failed after exhausting retries (expected)");
    console.log(`Final error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`\nTotal requests made to server: ${requestCount} (expected: 4 = 1 initial + 3 retries)`);

  // Wait a bit before next test
  await sleep(2000);

  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Circuit breaker opens after 5 consecutive failures");
  console.log("=".repeat(60));
  console.log("\nExpected: After 5 failed requests, circuit breaker opens");
  console.log("- First 5 requests: Should retry and fail");
  console.log("- 6th request: Should fast-fail with CircuitBreakerError\n");

  requestCount = 0;
  shouldFail = true;
  failureMode = "500";

  // Make 5 requests to trigger circuit breaker
  for (let i = 1; i <= 5; i++) {
    console.log(`\n--- Making request ${i}/5 to trigger circuit breaker ---`);
    try {
      await httpClient.get(testUrl);
    } catch (error) {
      console.log(`Request ${i} failed (expected): ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(500); // Small delay between requests
  }

  console.log("\n--- Circuit breaker should now be OPEN ---");
  console.log("--- Making 6th request (should fast-fail) ---\n");

  try {
    await httpClient.get(testUrl);
    console.log("\n❌ FAIL: Should have thrown CircuitBreakerError");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Circuit breaker")) {
      console.log("\n✅ PASS: Circuit breaker is OPEN (fast-failing)");
      console.log(`Error message: ${error.message}`);
    } else {
      console.log("\n❌ FAIL: Wrong error type");
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Circuit breaker closes after 30s timeout");
  console.log("=".repeat(60));
  console.log("\nExpected: After 30 seconds, circuit breaker transitions to HALF_OPEN");
  console.log("- If next request succeeds, transitions to CLOSED");
  console.log("- If next request fails, transitions back to OPEN\n");

  console.log("Waiting 30 seconds for circuit breaker to reset...");
  console.log("(You should see the circuit breaker error message above include a reset time)\n");

  // Wait for circuit breaker reset (30 seconds)
  for (let i = 30; i > 0; i--) {
    process.stdout.write(`\rCountdown: ${i}s remaining...`);
    await sleep(1000);
  }
  console.log("\r" + " ".repeat(40) + "\r"); // Clear countdown line

  console.log("\n--- Circuit breaker should now be HALF_OPEN ---");
  console.log("--- Making successful request to close circuit ---\n");

  // Allow successful response
  shouldFail = false;
  requestCount = 0;

  try {
    const result = await httpClient.get(testUrl);
    console.log("\n✅ PASS: Circuit breaker allowed request through (HALF_OPEN → CLOSED)");
    console.log(`Response: ${JSON.stringify(result.data)}`);
  } catch (error) {
    console.log("\n❌ FAIL: Should have succeeded");
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n--- Verifying circuit is now CLOSED by making another successful request ---\n");

  try {
    const result = await httpClient.get(testUrl);
    console.log("✅ PASS: Circuit breaker is CLOSED (normal operation)");
    console.log(`Response: ${JSON.stringify(result.data)}`);
  } catch (error) {
    console.log("❌ FAIL: Should have succeeded");
    console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("VERIFICATION COMPLETE");
  console.log("=".repeat(60));
  console.log("\nManual verification checklist:");
  console.log("[ ] Retry logs show attempt number (1/3, 2/3, 3/3)");
  console.log("[ ] Retry logs show delay with jitter (~1000ms, ~2000ms, ~4000ms)");
  console.log("[ ] Retry logs show error details");
  console.log("[ ] Circuit breaker opens after 5 failures");
  console.log("[ ] Circuit breaker error message is clear and includes reset time");
  console.log("[ ] Circuit breaker closes after 30s timeout");
  console.log("[ ] Circuit breaker allows requests through when CLOSED\n");

  // Cleanup
  server.close();
  process.exit(0);
}

// Run tests
runTests().catch((error) => {
  console.error("\nUnexpected error:", error);
  server.close();
  process.exit(1);
});
