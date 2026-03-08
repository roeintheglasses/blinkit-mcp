import { describe, test, expect, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerError,
} from "../../src/core/circuit-breaker.ts";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker("test", {
      failureThreshold: 3,
      resetTimeout: 1000,
    });
  });

  test("should be in CLOSED state initially", () => {
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });

  test("should execute operation successfully in CLOSED state", async () => {
    const result = await breaker.execute(async () => "success");
    expect(result).toBe("success");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });

  test("should increment failure count on operation failure", async () => {
    await expect(
      breaker.execute(async () => {
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");

    expect(breaker.getFailureCount()).toBe(1);
    expect(breaker.getState()).toBe("CLOSED");
  });

  test("should transition to OPEN after hitting failure threshold", async () => {
    // Fail 3 times to hit threshold
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getFailureCount()).toBe(3);
  });

  test("should throw CircuitBreakerError when OPEN", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    // Next call should fail fast
    await expect(
      breaker.execute(async () => "success")
    ).rejects.toThrow(CircuitBreakerError);

    await expect(
      breaker.execute(async () => "success")
    ).rejects.toThrow("Circuit breaker 'test' is OPEN");
  });

  test("should transition to HALF_OPEN after reset timeout", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    expect(breaker.getState()).toBe("OPEN");

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // State should now be HALF_OPEN when checked
    expect(breaker.getState()).toBe("HALF_OPEN");
  });

  test("should transition from HALF_OPEN to CLOSED on success", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Successful request should close the circuit
    const result = await breaker.execute(async () => "success");
    expect(result).toBe("success");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });

  test("should transition from HALF_OPEN to OPEN on failure", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Failed request should trip it again
    await expect(
      breaker.execute(async () => {
        throw new Error("fail again");
      })
    ).rejects.toThrow("fail again");

    expect(breaker.getState()).toBe("OPEN");
  });

  test("should reset to CLOSED state", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    expect(breaker.getState()).toBe("OPEN");

    // Reset the breaker
    breaker.reset();

    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getFailureCount()).toBe(0);
  });

  test("should return config values", () => {
    const config = breaker.getConfig();
    expect(config.failureThreshold).toBe(3);
    expect(config.resetTimeout).toBe(1000);
  });

  test("should provide next attempt time when OPEN", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(async () => {
          throw new Error("fail");
        })
      ).rejects.toThrow("fail");
    }

    const nextAttempt = breaker.getNextAttempt();
    expect(nextAttempt).toBeInstanceOf(Date);
    expect(nextAttempt!.getTime()).toBeGreaterThan(Date.now());
  });

  test("should return null for next attempt when CLOSED", () => {
    expect(breaker.getNextAttempt()).toBeNull();
  });
});
