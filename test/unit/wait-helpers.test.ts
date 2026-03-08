import { describe, test, expect, vi } from "vitest";
import { waitForCartUpdate, waitForConditionOrTimeout } from "../../src/playwright/helpers.ts";

function createMockPage(overrides: Record<string, any> = {}) {
  return {
    waitForResponse: vi.fn(),
    waitForFunction: vi.fn(),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe("waitForCartUpdate", () => {
  test("returns true when a matching cart response is detected", async () => {
    const mockResponse = { url: () => "/v6/cart/update", status: () => 200 };
    const page = createMockPage({
      waitForResponse: vi.fn().mockResolvedValue(mockResponse),
    });

    const result = await waitForCartUpdate(page);
    expect(result).toBe(true);
    expect(page.waitForResponse).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 3000 }
    );
  });

  test("returns false on timeout when no response arrives", async () => {
    const page = createMockPage({
      waitForResponse: vi.fn().mockRejectedValue(new Error("Timeout")),
    });

    const result = await waitForCartUpdate(page);
    expect(result).toBe(false);
  });

  test("passes custom timeout", async () => {
    const page = createMockPage({
      waitForResponse: vi.fn().mockResolvedValue({}),
    });

    await waitForCartUpdate(page, 5000);
    expect(page.waitForResponse).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 5000 }
    );
  });

  test("predicate matches correct URLs", async () => {
    let capturedPredicate: (resp: any) => boolean;
    const page = createMockPage({
      waitForResponse: vi.fn().mockImplementation((pred: any) => {
        capturedPredicate = pred;
        return Promise.resolve({});
      }),
    });

    await waitForCartUpdate(page);

    // Should match /v6/cart/ URLs with status 200
    expect(capturedPredicate!({ url: () => "https://blinkit.com/v6/cart/update", status: () => 200 })).toBe(true);
    // Should reject non-cart URLs
    expect(capturedPredicate!({ url: () => "https://blinkit.com/v6/search", status: () => 200 })).toBe(false);
    // Should reject non-200 status
    expect(capturedPredicate!({ url: () => "https://blinkit.com/v6/cart/update", status: () => 500 })).toBe(false);
  });
});

describe("waitForConditionOrTimeout", () => {
  test("returns true when condition is met before timeout", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    });

    const result = await waitForConditionOrTimeout(page, "document.querySelector('.done')");
    expect(result).toBe(true);
  });

  test("returns false when condition times out", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockRejectedValue(new Error("Timeout")),
    });

    const result = await waitForConditionOrTimeout(page, "document.querySelector('.done')");
    expect(result).toBe(false);
  });

  test("applies debounce after condition is met", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    });

    await waitForConditionOrTimeout(page, "true", { debounceMs: 200 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(200);
  });

  test("skips debounce when debounceMs is 0", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    });

    await waitForConditionOrTimeout(page, "true", { debounceMs: 0 });
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  test("passes custom timeout to waitForFunction", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockResolvedValue(undefined),
    });

    await waitForConditionOrTimeout(page, "true", { timeout: 10000 });
    expect(page.waitForFunction).toHaveBeenCalledWith("true", undefined, { timeout: 10000 });
  });

  test("does not debounce on timeout failure", async () => {
    const page = createMockPage({
      waitForFunction: vi.fn().mockRejectedValue(new Error("Timeout")),
    });

    await waitForConditionOrTimeout(page, "true");
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});
