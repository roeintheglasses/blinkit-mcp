import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import { waitAndClick, extractNumber } from "./helpers.ts";
import { BLINKIT_BASE_URL } from "../constants.ts";
import type { OrderSummary, OrderTracking } from "../types.ts";

export async function getCheckoutSummary(page: Page): Promise<{
  total: number;
  items_count: number;
  delivery_fee: number;
  summary_text: string;
}> {
  await page.goto(`${BLINKIT_BASE_URL}/checkout/cart`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // Click proceed to see order summary
  try {
    await waitAndClick(page, SELECTORS.PROCEED_BUTTON, 5000);
    await page.waitForTimeout(3000);
  } catch {
    // May already be on summary page
  }

  const totalText = await page.locator(SELECTORS.ORDER_SUMMARY).textContent().catch(() => null);
  const total = extractNumber(totalText);

  return {
    total,
    items_count: 0,
    delivery_fee: 0,
    summary_text: totalText?.trim() ?? "Unable to retrieve order summary",
  };
}

export async function proceedToPayment(page: Page): Promise<{
  success: boolean;
  payment_methods: string[];
}> {
  try {
    await waitAndClick(page, SELECTORS.PROCEED_BUTTON, 5000);
    await page.waitForTimeout(3000);

    // Detect available payment methods but DO NOT click Pay
    const paymentMethods: string[] = [];
    const paymentWidget = page.locator(SELECTORS.PAYMENT_WIDGET);
    if (await paymentWidget.count() > 0) {
      const text = await paymentWidget.textContent().catch(() => "");
      if (text?.includes("UPI")) paymentMethods.push("UPI");
      if (text?.includes("Card")) paymentMethods.push("Card");
      if (text?.includes("COD") || text?.includes("Cash")) paymentMethods.push("Cash on Delivery");
      if (text?.includes("Wallet")) paymentMethods.push("Wallet");
    }

    return { success: true, payment_methods: paymentMethods };
  } catch {
    return { success: false, payment_methods: [] };
  }
}

export async function getOrderHistory(page: Page, limit: number): Promise<OrderSummary[]> {
  await page.goto(`${BLINKIT_BASE_URL}/orders`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  const orders: OrderSummary[] = [];
  const orderCards = page.locator(SELECTORS.ORDER_CARD);
  const count = Math.min(await orderCards.count(), limit);

  for (let i = 0; i < count; i++) {
    try {
      const card = orderCards.nth(i);
      const status = await card.locator(SELECTORS.ORDER_STATUS).textContent().catch(() => null);
      const totalText = await card.locator(SELECTORS.ORDER_TOTAL).textContent().catch(() => null);
      const date = await card.locator(SELECTORS.ORDER_DATE).textContent().catch(() => null);
      const items = await card.locator(SELECTORS.ORDER_ITEMS).textContent().catch(() => null);

      orders.push({
        order_id: `order-${i}`,
        date: date?.trim() ?? "",
        total: extractNumber(totalText),
        item_count: 0,
        status: status?.trim() ?? "Unknown",
        items_summary: items?.trim() ?? "",
      });
    } catch {
      // Skip
    }
  }

  return orders;
}

export async function trackOrder(page: Page, orderId?: string): Promise<OrderTracking | null> {
  const url = orderId
    ? `${BLINKIT_BASE_URL}/order/${orderId}`
    : `${BLINKIT_BASE_URL}/orders`;

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // If no specific order, click the most recent one
  if (!orderId) {
    try {
      const firstOrder = page.locator(SELECTORS.ORDER_CARD).first();
      await firstOrder.click();
      await page.waitForTimeout(2000);
    } catch {
      return null;
    }
  }

  const status = await page.locator(SELECTORS.ORDER_STATUS).first().textContent().catch(() => null);
  const etaText = await page.locator(SELECTORS.ORDER_ETA).first().textContent().catch(() => null);

  const timeline: { time: string; status: string }[] = [];
  const timelineItems = page.locator(SELECTORS.ORDER_TRACKING_TIMELINE);
  const count = await timelineItems.count();
  for (let i = 0; i < count; i++) {
    const text = await timelineItems.nth(i).textContent().catch(() => null);
    if (text) {
      timeline.push({ time: "", status: text.trim() });
    }
  }

  return {
    order_id: orderId ?? "latest",
    status: status?.trim() ?? "Unknown",
    eta_minutes: etaText ? extractNumber(etaText) : undefined,
    timeline,
  };
}
