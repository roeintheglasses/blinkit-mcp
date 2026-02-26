import { describe, test, expect } from "vitest";
import { SpendingGuard } from "../../src/services/spending-guard.ts";

describe("SpendingGuard", () => {
  const guard = new SpendingGuard({
    warn_threshold: 500,
    max_order_amount: 2000,
    headless: true,
    playwright_mode: "bridge",
  });

  test("allows under warning threshold", () => {
    const result = guard.check(200);
    expect(result.allowed).toBe(true);
    expect(result.exceeded_hard_limit).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  test("allows at exactly warning threshold", () => {
    const result = guard.check(500);
    expect(result.allowed).toBe(true);
    expect(result.exceeded_hard_limit).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  test("warns above warning threshold", () => {
    const result = guard.check(750);
    expect(result.allowed).toBe(true);
    expect(result.exceeded_hard_limit).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("750");
    expect(result.warning).toContain("500");
  });

  test("allows at exactly hard limit", () => {
    const result = guard.check(2000);
    expect(result.allowed).toBe(true);
    expect(result.exceeded_hard_limit).toBe(false);
    // Should still show warning since 2000 > 500
    expect(result.warning).toBeDefined();
  });

  test("blocks above hard limit", () => {
    const result = guard.check(2500);
    expect(result.allowed).toBe(false);
    expect(result.exceeded_hard_limit).toBe(true);
    expect(result.warning).toContain("2500");
    expect(result.warning).toContain("2000");
  });

  test("handles zero cart total", () => {
    const result = guard.check(0);
    expect(result.allowed).toBe(true);
    expect(result.exceeded_hard_limit).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  test("uses custom thresholds", () => {
    const customGuard = new SpendingGuard({
      warn_threshold: 100,
      max_order_amount: 500,
      headless: true,
      playwright_mode: "bridge",
    });

    expect(customGuard.check(50).warning).toBeUndefined();
    expect(customGuard.check(150).warning).toBeDefined();
    expect(customGuard.check(150).allowed).toBe(true);
    expect(customGuard.check(600).allowed).toBe(false);
    expect(customGuard.check(600).exceeded_hard_limit).toBe(true);
  });
});
