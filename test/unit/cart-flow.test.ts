import { describe, test, expect, vi } from "vitest";
import { extractCartTotal } from "../../src/playwright/cart-flow.ts";
import type { Page, Locator } from "playwright";

describe("extractCartTotal", () => {
  // Helper to create a mock locator
  function mockLocator(text: string, count = 1): Partial<Locator> {
    return {
      count: vi.fn().mockResolvedValue(count),
      first: vi.fn().mockReturnValue({
        innerText: vi.fn().mockResolvedValue(text),
      }),
      allInnerTexts: vi.fn().mockResolvedValue([text]),
    } as Partial<Locator>;
  }

  test("extracts total from cart button with rupee symbol", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("₹1,250");
        }
        return mockLocator("", 0);
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(1250);
  });

  test("extracts total from cart button without rupee symbol", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("750");
        }
        return mockLocator("", 0);
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(750);
  });

  test("extracts total from cart button with decimal", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("₹99.50");
        }
        return mockLocator("", 0);
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(99.5);
  });

  test("falls back to bill details when cart button has no price", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("Cart");
        }
        // Bill details selector
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue([
            "Items total ₹500\nDelivery charge ₹25\nGrand total ₹525",
          ]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(525);
  });

  test("extracts grand total from bill details with comma separator", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("", 0);
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue([
            "Items total ₹1,500\nDelivery charge ₹30\nGrand total ₹1,530",
          ]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(1530);
  });

  test("extracts grand total from bill details without rupee symbol", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("", 0);
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue([
            "Items total 500\nDelivery charge 25\nGrand total 525",
          ]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(525);
  });

  test("returns 0 when cart button is not found", async () => {
    const page = {
      locator: vi.fn(() => mockLocator("", 0)),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(0);
  });

  test("returns 0 when bill details has no grand total", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("Cart");
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue(["Items total ₹500"]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(0);
  });

  test("returns 0 when both cart button and bill details fail", async () => {
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn().mockResolvedValue(0),
        allInnerTexts: vi.fn().mockResolvedValue([]),
      } as Partial<Locator>)),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(0);
  });

  test("handles cart button innerText rejection gracefully", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return {
            count: vi.fn().mockResolvedValue(1),
            first: vi.fn().mockReturnValue({
              innerText: vi.fn().mockRejectedValue(new Error("Element not found")),
            }),
          } as Partial<Locator>;
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue([
            "Grand total ₹300",
          ]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(300);
  });

  test("handles allInnerTexts rejection gracefully", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("", 0);
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockRejectedValue(new Error("Failed to read")),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(0);
  });

  test("prefers cart button over bill details when both available", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("₹999");
        }
        return {
          count: vi.fn().mockResolvedValue(1),
          allInnerTexts: vi.fn().mockResolvedValue([
            "Grand total ₹1,500",
          ]),
        } as Partial<Locator>;
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(999); // Should use cart button value, not bill details
  });

  test("handles large amounts with multiple comma separators", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("₹12,345.67");
        }
        return mockLocator("", 0);
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(12345.67);
  });

  test("handles zero cart total", async () => {
    const page = {
      locator: vi.fn((selector: string) => {
        if (selector.includes("Cart")) {
          return mockLocator("₹0");
        }
        return mockLocator("", 0);
      }),
    } as unknown as Page;

    const total = await extractCartTotal(page);
    expect(total).toBe(0);
  });
});
