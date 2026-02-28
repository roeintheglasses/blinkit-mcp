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
    const cartBtn = page.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container'], div[class*='CartButton']");
    if (await cartBtn.count() > 0) {
      await cartBtn.first().click();
      log("Clicked cart button.");
      await page.waitForTimeout(2000);
    } else {
      log("Could not find cart button.");
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
        message: "Checkout initiated. Payment page is ready. Use get_payment_methods to see available options.",
      };
    } else {
      // Try navigating through intermediate screens
      const navResult = await navigateToPaymentWidget(page, 10000);
      if (navResult.reached) {
        return {
          next_step: "payment",
          message: "Checkout initiated. Payment page is ready. Use get_payment_methods to see available options.",
          skipped_steps: navResult.skippedSteps,
        };
      } else {
        return {
          next_step: "unknown",
          message: "Checkout initiated. Check page state -- you may need get_saved_addresses or get_payment_methods.",
        };
      }
    }
  } else {
    throw new Error("Proceed button not visible. Cart might be empty or store unavailable.");
  }
}

// ─── Payment iframe helpers ──────────────────────────────────────────────────

/**
 * Get the payment iframe's content frame.
 * Returns null if iframe not found or not accessible.
 */
async function getPaymentFrame(page: Page, timeoutMs = 15000) {
  const iframeElement = await page.waitForSelector("#payment_widget", { timeout: timeoutMs }).catch(() => null);
  if (!iframeElement) return null;
  const frame = await iframeElement.contentFrame();
  if (!frame) return null;
  await frame.waitForLoadState("domcontentloaded").catch(() => {});
  return frame;
}

/**
 * Capture the UPI QR code image from the payment iframe.
 * Tries two strategies:
 *   1. Screenshot the QR wrapper element (larger, display-sized)
 *   2. Extract the base64 data URL from the QR img src
 * Returns base64-encoded PNG string, or null if not found.
 */
async function captureQrCode(frame: import("playwright").Frame): Promise<string | null> {
  try {
    // Strategy 1: Screenshot the QR wrapper container (rendered at display size)
    const qrWrapper = frame.locator("div[class*='QrWrapper'], div[class*='qr-wrapper'], div[class*='QrImage']").first();
    if (await qrWrapper.count() > 0 && await qrWrapper.isVisible().catch(() => false)) {
      const buffer = await qrWrapper.screenshot();
      log("Captured QR code via element screenshot");
      return buffer.toString("base64");
    }

    // Strategy 2: Extract the base64 data URL from the QR image
    const qrDataImg = frame.locator("img[src^='data:image']").first();
    if (await qrDataImg.count() > 0) {
      const src = await qrDataImg.getAttribute("src");
      if (src && src.startsWith("data:image/png;base64,")) {
        log("Captured QR code via data URL extraction");
        return src.replace("data:image/png;base64,", "");
      }
    }

    // Strategy 3: Screenshot any visible canvas (some QR renderers use canvas)
    const canvas = frame.locator("canvas").first();
    if (await canvas.count() > 0 && await canvas.isVisible().catch(() => false)) {
      const buffer = await canvas.screenshot();
      log("Captured QR code via canvas screenshot");
      return buffer.toString("base64");
    }

    log("Could not find QR code element to capture");
    return null;
  } catch (e) {
    log(`QR capture failed: ${e}`);
    return null;
  }
}

/**
 * Get available payment methods from the payment widget iframe.
 * Returns structured list of methods with their status.
 */
export async function getPaymentMethods(page: Page): Promise<{
  methods: Array<{
    name: string;
    type: string;
    available: boolean;
    details?: string;
  }>;
  hint?: string;
}> {
  log("Getting available payment methods...");

  // Ensure we're on the checkout page with payment widget
  let hasWidget = await page.locator("#payment_widget").count() > 0;
  if (!hasWidget) {
    log("Payment widget not visible. Trying to navigate to it...");
    const navResult = await navigateToPaymentWidget(page, 15000);
    hasWidget = navResult.reached;
  }

  const frame = await getPaymentFrame(page);
  if (!frame) {
    return {
      methods: [],
      hint: "Payment widget not found. Make sure checkout and address selection are complete.",
    };
  }

  const methods: Array<{ name: string; type: string; available: boolean; details?: string }> = [];
  const frameText = await frame.locator("body").innerText().catch(() => "");

  // Detect available payment methods from iframe content
  // Use :has-text() for substring matching since actual headers vary
  // (e.g. "Add credit or debit cards" vs "credit or debit")
  const methodChecks = [
    { name: "Wallets", type: "wallets", text: "Wallets", selector: "text='Wallets'" },
    { name: "Credit/Debit Cards", type: "card", text: "credit or debit", selector: "text=/credit or debit/i" },
    { name: "Netbanking", type: "netbanking", text: "Netbanking", selector: "text='Netbanking'" },
    { name: "UPI", type: "upi", text: "UPI", selector: "text='UPI'" },
    { name: "Cash on Delivery", type: "cod", text: "Cash", selector: "text='Cash'" },
    { name: "Pay Later", type: "pay_later", text: "Pay Later", selector: "text='Pay Later'" },
  ];

  for (const check of methodChecks) {
    const methodLocator = frame.locator(check.selector).first();
    if (await methodLocator.count().catch(() => 0) > 0) {
      let details: string | undefined;
      const isAvailable = !frameText.includes(`${check.text}`) || true; // Present means available

      // Check for specific details
      if (check.type === "card") {
        // Look for saved cards
        const savedCard = frameText.match(/\*+\s*\d{4}/);
        if (savedCard) {
          details = `Saved card ending in ${savedCard[0].replace(/\*+\s*/, "")}`;
        }
      } else if (check.type === "cod") {
        if (frameText.includes("not available")) {
          details = "Not available for this order";
        }
      } else if (check.type === "upi") {
        details = "QR code based — scan with any UPI app";
      }

      methods.push({
        name: check.name,
        type: check.type,
        available: check.type === "cod" ? !frameText.includes("not available") : true,
        details,
      });
    }
  }

  log(`Found ${methods.length} payment methods`);
  return { methods };
}

/**
 * Select/expand a payment method section in the iframe.
 * For UPI, this expands the section and may generate a QR code.
 * For Card, this expands and shows saved cards or input.
 */
export async function selectPaymentMethod(page: Page, methodType: string): Promise<{
  selected: boolean;
  message: string;
  action_needed?: string;
  qr_image_base64?: string;
}> {
  log(`Selecting payment method: ${methodType}`);

  const frame = await getPaymentFrame(page);
  if (!frame) {
    throw new Error("Payment widget not found. Complete checkout first.");
  }

  // Map method types to selectors for finding the section header
  const methodMap: Record<string, { label: string; selector: string }> = {
    upi: { label: "UPI", selector: "text='UPI'" },
    card: { label: "Credit/Debit Cards", selector: "text=/credit or debit/i" },
    netbanking: { label: "Netbanking", selector: "text='Netbanking'" },
    wallets: { label: "Wallets", selector: "text='Wallets'" },
    cod: { label: "Cash", selector: "text='Cash'" },
    pay_later: { label: "Pay Later", selector: "text='Pay Later'" },
  };

  const method = methodMap[methodType.toLowerCase()];
  if (!method) {
    throw new Error(`Unknown payment method: ${methodType}. Available: ${Object.keys(methodMap).join(", ")}`);
  }

  // Click on the method header to expand it
  const header = frame.locator(method.selector).first();
  if (await header.count() === 0) {
    throw new Error(`Payment method '${method.label}' not found on the payment page.`);
  }

  await header.click();
  await page.waitForTimeout(2000);

  // Handle method-specific behavior
  if (methodType.toLowerCase() === "upi") {
    // Check for "Generate QR" button
    const generateQr = frame.locator("text='Generate QR'");
    if (await generateQr.count() > 0 && await generateQr.first().isVisible().catch(() => false)) {
      await generateQr.first().click();
      log("Clicked 'Generate QR' for UPI payment");
      await page.waitForTimeout(3000);
    }

    // Capture the QR code image
    const qrBase64 = await captureQrCode(frame);

    return {
      selected: true,
      message: "UPI selected. QR code generated.",
      action_needed: "Scan the QR code with your UPI app (Google Pay, PhonePe, Paytm) to complete payment.",
      qr_image_base64: qrBase64 ?? undefined,
    };
  }

  if (methodType.toLowerCase() === "card") {
    // Check if saved card is present
    const frameText = await frame.locator("body").innerText().catch(() => "");
    const hasSavedCard = frameText.includes("CVV") || frameText.match(/\*+\s*\d{4}/);
    if (hasSavedCard) {
      return {
        selected: true,
        message: "Card payment selected. Saved card is available.",
        action_needed: "Enter the CVV for your saved card, then use pay_now to complete payment.",
      };
    }
    return {
      selected: true,
      message: "Card section expanded.",
      action_needed: "Add a card or select a saved card, then use pay_now.",
    };
  }

  return {
    selected: true,
    message: `${method.label} section expanded.`,
  };
}

/**
 * Click the "Pay Now" button to initiate payment.
 * The Pay Now button is on the MAIN PAGE (not inside the iframe).
 */
export async function payNow(page: Page): Promise<{ message: string }> {
  log("Clicking Pay Now...");

  // Strategy 1: Look for "Pay Now" on the main page (outside iframe)
  // It's typically in the right sidebar / order summary area
  const payBtnOnPage = page.locator("button:has-text('Pay Now'), div:has-text('Pay Now')").last();
  if (await payBtnOnPage.count() > 0 && await payBtnOnPage.isVisible().catch(() => false)) {
    await payBtnOnPage.click();
    log("Clicked 'Pay Now' on main page.");
    return { message: "Pay Now clicked. Complete payment on your device (approve UPI request or enter OTP for card)." };
  }

  // Strategy 2: Try inside iframe as fallback
  const frame = await getPaymentFrame(page, 5000);
  if (frame) {
    const frameBtn = frame.locator("text='Pay Now'");
    if (await frameBtn.count() > 0 && await frameBtn.first().isVisible().catch(() => false)) {
      await frameBtn.first().click();
      log("Clicked 'Pay Now' inside payment iframe.");
      return { message: "Pay Now clicked. Complete payment on your device." };
    }
  }

  // Strategy 3: Try Zpayments-specific button
  const zpayBtn = page.locator("div[class*='Zpayments__Button']:has-text('Pay Now')");
  if (await zpayBtn.count() > 0 && await zpayBtn.first().isVisible().catch(() => false)) {
    await zpayBtn.first().click();
    log("Clicked 'Pay Now' Zpayments button.");
    return { message: "Pay Now clicked. Complete payment on your device." };
  }

  throw new Error("Could not find 'Pay Now' button. Make sure you are on the payment page and have selected a payment method.");
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
