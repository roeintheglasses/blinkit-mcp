import type { Page } from "playwright";

export async function waitAndClick(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

export async function waitAndFill(page: Page, selector: string, text: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout });
  await page.fill(selector, text);
}

export async function safeText(page: Page, selector: string, timeout = 5000): Promise<string | null> {
  try {
    await page.waitForSelector(selector, { timeout });
    return await page.textContent(selector);
  } catch {
    return null;
  }
}

export async function safeQueryAll(page: Page, selector: string): Promise<Array<ReturnType<Page["locator"]>>> {
  const locator = page.locator(selector);
  const count = await locator.count();
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(locator.nth(i));
  }
  return results;
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

export async function waitForNavigation(page: Page, action: () => Promise<void>, timeout = 15000): Promise<void> {
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout }).catch(() => {}),
    action(),
  ]);
}

export function extractNumber(text: string | null): number {
  if (!text) return 0;
  const match = text.replace(/,/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

export function extractProductId(href: string | null): string | null {
  if (!href) return null;
  // Pattern: /prn/product-name/prid/12345
  const match = href.match(/\/prid\/(\d+)/);
  return match ? match[1] : null;
}
