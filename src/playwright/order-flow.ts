import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

/**
 * Fetch recent orders from the orders page.
 * Returns basic order information extracted from order cards.
 *
 * @param page - Playwright page instance
 * @param limit - Maximum number of orders to fetch
 * @returns Array of order objects with order_id and text content
 */
export async function getOrders(page: Page, limit: number): Promise<Array<Record<string, unknown>>> {
  await page.goto("https://blinkit.com/orders", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(SELECTORS.ORDER_CARD, { timeout: 10000 }).catch(() => null);

  const orders: Array<Record<string, unknown>> = [];
  const orderCards = page.locator(SELECTORS.ORDER_CARD);
  const orderCount = Math.min(await orderCards.count(), limit);

  for (let i = 0; i < orderCount; i++) {
    try {
      const card = orderCards.nth(i);
      const cardText = await card.innerText().catch(() => "");

      orders.push({
        order_id: `order-${i}`,
        text: cardText.trim(),
      });
    } catch {
      // Skip
    }
  }

  return orders;
}

/**
 * Track a specific order or the most recent one.
 * Navigates to the order details page and returns tracking information.
 *
 * @param page - Playwright page instance
 * @param orderId - Optional order ID to track. If not provided, tracks the most recent order.
 * @returns Order tracking details including status and page content
 * @throws Error if no orders found when tracking latest order
 */
export async function trackOrder(page: Page, orderId?: string): Promise<Record<string, unknown>> {
  const url = orderId
    ? `https://blinkit.com/order/${orderId}`
    : "https://blinkit.com/orders";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(SELECTORS.ORDER_CARD, { timeout: 10000 }).catch(() => null);

  if (!orderId) {
    try {
      await page.locator(SELECTORS.ORDER_CARD).first().click();
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    } catch {
      throw new Error("No orders found");
    }
  }

  const pageText = await page.locator("body").innerText().catch(() => "");

  return {
    order_id: orderId ?? "latest",
    status: "See tracking details below",
    page_text: pageText.substring(0, 2000),
  };
}
