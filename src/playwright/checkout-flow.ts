import type { Page } from "playwright";
import { isStoreClosed, navigateToPaymentWidget } from "./helpers.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

/**
 * Initiate checkout by clicking Proceed in the cart.
 * Detects what state we land in (address selection, payment, etc.).
 */
export async function checkout(page: Page): Promise<{
  next_step: string;
  message: string;
  skipped_steps?: string[];
}> {
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    throw new Error(`CRITICAL: ${storeStatus}`);
  }

  const proceedBtn = page.locator("button, div").filter({ hasText: "Proceed" }).last();

  // If Proceed not visible, try opening the cart first
  if (!await proceedBtn.isVisible().catch(() => false)) {
    log("Proceed button not visible. Attempting to open Cart drawer...");
    const cartBtn = page.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
    if (await cartBtn.count() > 0) {
      await cartBtn.first().click();
      log("Clicked 'My Cart' button.");
      await page.waitForTimeout(2000);
    } else {
      log("Could not find 'My Cart' button.");
    }
  }

  // Try clicking Proceed
  if (await proceedBtn.isVisible().catch(() => false)) {
    await proceedBtn.click();
    log("Cart checkout initiated.");
    await page.waitForTimeout(3000);

    // Detect what state we landed in
    if (await page.isVisible("text='Select delivery address'").catch(() => false)) {
      return {
        next_step: "select_address",
        message: "Checkout initiated. Address selection is showing. Use get_saved_addresses then select_address.",
      };
    } else if (await page.locator("#payment_widget").count() > 0) {
      return {
        next_step: "payment",
        message: "Checkout initiated. Payment page is ready. Use get_upi_ids.",
      };
    } else {
      // Try navigating through intermediate screens
      const navResult = await navigateToPaymentWidget(page, 10000);
      if (navResult.reached) {
        return {
          next_step: "payment",
          message: "Checkout initiated. Payment page is ready. Use get_upi_ids.",
          skipped_steps: navResult.skippedSteps,
        };
      } else {
        return {
          next_step: "unknown",
          message: "Checkout initiated. Check page state -- you may need get_saved_addresses or get_upi_ids.",
        };
      }
    }
  } else {
    throw new Error("Proceed button not visible. Cart might be empty or store unavailable.");
  }
}

/**
 * Get available UPI IDs from the payment widget iframe.
 */
export async function getUpiIds(page: Page): Promise<{ upi_ids: string[]; hint?: string }> {
  log("Getting available UPI IDs...");

  // Check if payment widget is already present
  let hasWidget = await page.locator("#payment_widget").count() > 0;

  // If not, try navigating through any intermediate screens first
  if (!hasWidget) {
    log("Payment widget not immediately visible. Checking for intermediate screens...");
    const navResult = await navigateToPaymentWidget(page, 15000);
    if (navResult.skippedSteps.length > 0) {
      log(`Navigated through: ${navResult.skippedSteps.join(", ")}`);
    }
    hasWidget = navResult.reached;
  }

  // Now wait for the iframe
  const iframeElement = await page.waitForSelector("#payment_widget", { timeout: 20000 }).catch(() => null);
  if (!iframeElement) {
    return {
      upi_ids: [],
      hint: "Payment widget not found. Make sure checkout and address selection are complete.",
    };
  }

  const frame = await iframeElement.contentFrame();
  if (!frame) {
    return { upi_ids: [] };
  }

  await frame.waitForLoadState("networkidle");

  const ids: string[] = [];
  // Find elements that look like VPAs (contain @) inside the iframe
  const vpaLocators = frame.locator("text=/@/");
  const vpaCount = await vpaLocators.count();
  for (let i = 0; i < vpaCount; i++) {
    const text = await vpaLocators.nth(i).innerText();
    if (text.includes("@")) {
      ids.push(text.trim());
    }
  }

  // Check for "Add new UPI ID" option
  if (await frame.locator("text='Add new UPI ID'").count() > 0) {
    ids.push("Add new UPI ID");
  }

  log(`Found UPI IDs: ${ids.join(", ")}`);
  return { upi_ids: ids };
}

/**
 * Select a UPI ID in the payment widget iframe.
 * Can select a saved VPA or enter a new one.
 */
export async function selectUpiId(page: Page, upiId: string): Promise<{ selected: boolean }> {
  log(`Selecting UPI ID: ${upiId}`);

  const iframeElement = await page.waitForSelector("#payment_widget", { timeout: 30000 }).catch(() => null);
  if (!iframeElement) {
    throw new Error("Payment widget iframe not found");
  }

  const frame = await iframeElement.contentFrame();
  if (!frame) {
    throw new Error("Could not access payment iframe");
  }

  // 1. Try clicking on a saved VPA
  const savedVpa = frame.locator(`text='${upiId}'`);
  if (await savedVpa.count() > 0) {
    await savedVpa.first().click();
    log(`Clicked saved VPA: ${upiId}`);
    return { selected: true };
  }

  // 2. Expand UPI section if needed
  const upiHeader = frame.locator("div").filter({ hasText: "UPI" }).last();
  if (await upiHeader.count() > 0) {
    await upiHeader.click();
  }
  await page.waitForTimeout(500);

  // 3. Enter VPA in input
  const inputLocator = frame.locator("input[placeholder*='UPI'], input[type='text']");
  if (await inputLocator.count() > 0) {
    await inputLocator.first().fill(upiId);
    log(`Filled UPI ID: ${upiId}`);
  }

  // Click Verify
  const verifyBtn = frame.locator("text='Verify'");
  if (await verifyBtn.count() > 0) {
    await verifyBtn.click();
    log("Clicked Verify button.");
  }

  return { selected: true };
}

/**
 * Click the "Pay Now" button to initiate payment.
 * Tries multiple strategies: specific class match, text match, iframe.
 */
export async function payNow(page: Page): Promise<{ message: string }> {
  log("Clicking Pay Now...");

  // Strategy 1: Specific class match
  const payBtnSpecific = page.locator("div[class*='Zpayments__Button']:has-text('Pay Now')");
  if (await payBtnSpecific.count() > 0 && await payBtnSpecific.first().isVisible().catch(() => false)) {
    await payBtnSpecific.first().click();
    log("Clicked 'Pay Now'. Please approve the payment on your UPI app.");
    return { message: "Pay Now clicked. Approve payment on your UPI app." };
  }

  // Strategy 2: Text match on page
  const payBtnText = page.locator("div, button").filter({ hasText: "Pay Now" }).last();
  if (await payBtnText.count() > 0 && await payBtnText.isVisible().catch(() => false)) {
    await payBtnText.click();
    log("Clicked 'Pay Now'. Please approve the payment on your UPI app.");
    return { message: "Pay Now clicked. Approve payment on your UPI app." };
  }

  // Strategy 3: Check inside iframe
  const iframeElement = await page.waitForSelector("#payment_widget", { timeout: 5000 }).catch(() => null);
  if (iframeElement) {
    const frame = await iframeElement.contentFrame();
    if (frame) {
      const frameBtn = frame.locator("text='Pay Now'");
      if (await frameBtn.count() > 0) {
        await frameBtn.first().click();
        log("Clicked 'Pay Now' inside iframe.");
        return { message: "Pay Now clicked inside iframe. Approve payment on your UPI app." };
      }
    }
  }

  throw new Error("Could not find 'Pay Now' button.");
}

/**
 * Get order history.
 */
export async function getOrders(page: Page, limit: number): Promise<Array<Record<string, unknown>>> {
  await page.goto("https://blinkit.com/orders", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  const orders: Array<Record<string, unknown>> = [];
  const orderCards = page.locator("div[class*='OrderCard'], div[class*='order-card']");
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
 */
export async function trackOrder(page: Page, orderId?: string): Promise<Record<string, unknown>> {
  const url = orderId
    ? `https://blinkit.com/order/${orderId}`
    : "https://blinkit.com/orders";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  if (!orderId) {
    try {
      await page.locator("div[class*='OrderCard'], div[class*='order-card']").first().click();
      await page.waitForTimeout(2000);
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
