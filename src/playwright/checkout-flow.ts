import type { Page } from "playwright";
import { isStoreClosed, navigateToPaymentWidget } from "./helpers.js";
import { SELECTORS } from "./selectors.js";
import QRCode from "qrcode";

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
    const cartBtn = page.locator(SELECTORS.CART_BUTTON_FULL);
    if (await cartBtn.count() > 0) {
      try {
        await cartBtn.first().click({ force: true, timeout: 10000 });
      } catch {
        await cartBtn.first().evaluate((el: any) => el.click()).catch(() => {});
      }
      log("Clicked cart button.");
      await page.waitForTimeout(2000);
    } else {
      log("Could not find cart button.");
    }
  }

  // Try clicking Proceed — use force:true since it's often in a sticky footer
  if (await proceedBtn.isVisible().catch(() => false)) {
    try {
      await proceedBtn.click({ force: true, timeout: 10000 });
    } catch {
      log("Proceed button force-click failed, trying JS click...");
      await proceedBtn.evaluate((el: any) => el.click()).catch(() => {});
    }
    log("Cart checkout initiated.");
    await page.waitForTimeout(3000);

    // Detect what state we landed in
    if (await page.isVisible(SELECTORS.SELECT_DELIVERY_ADDRESS).catch(() => false)) {
      return {
        next_step: "select_address",
        message: "Checkout initiated. Address selection is showing. Use get_saved_addresses then select_address.",
      };
    } else if (await page.locator(SELECTORS.PAYMENT_WIDGET).count() > 0) {
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
  const iframeElement = await page.waitForSelector(SELECTORS.PAYMENT_WIDGET, { timeout: timeoutMs }).catch(() => null);
  if (!iframeElement) return null;
  const frame = await iframeElement.contentFrame();
  if (!frame) return null;
  await frame.waitForLoadState("domcontentloaded").catch(() => {});
  return frame;
}

/**
 * Try to extract the UPI URL directly from the payment iframe DOM.
 * Searches data attributes, anchor hrefs, and JS variables for upi:// URLs.
 */
async function extractUpiUrl(frame: import("playwright").Frame): Promise<string | null> {
  try {
    const upiUrl = await frame.evaluate(`(() => {
      const allElements = document.querySelectorAll("*");
      for (const el of allElements) {
        for (const attr of el.attributes) {
          if (attr.value.includes("upi://")) {
            const m = attr.value.match(/upi:\\/\\/[^\\s"'<>]+/);
            return m ? m[0] : null;
          }
          if (attr.value.includes("upi%3A%2F%2F")) {
            const decoded = decodeURIComponent(attr.value);
            const m = decoded.match(/upi:\\/\\/[^\\s"'<>]+/);
            return m ? m[0] : null;
          }
        }
        if (el.children.length === 0 && el.textContent && el.textContent.includes("upi://")) {
          const m = el.textContent.match(/upi:\\/\\/[^\\s"'<>]+/);
          return m ? m[0] : null;
        }
      }
      const links = document.querySelectorAll("a[href]");
      for (const link of links) {
        const href = link.href;
        if (href && href.includes("upi://")) {
          const m = href.match(/upi:\\/\\/[^\\s"'<>]+/);
          return m ? m[0] : null;
        }
      }
      return null;
    })()`) as string | null;

    if (upiUrl) {
      log(`Extracted UPI URL from DOM: ${upiUrl.substring(0, 80)}...`);
    }
    return upiUrl;
  } catch (e) {
    log(`UPI URL extraction from DOM failed: ${e}`);
    return null;
  }
}

/**
 * Decode a QR code PNG buffer to extract the encoded data string.
 * Uses pngjs + @paulmillr/qr (dynamically imported).
 * This is a fallback when DOM extraction fails.
 */
async function decodeQrFromPng(pngBuffer: Buffer): Promise<string | null> {
  try {
    const { PNG } = await import("pngjs");
    const { default: decodeQR } = await import("@paulmillr/qr/decode.js");
    const png = PNG.sync.read(pngBuffer);
    const data = decodeQR({
      height: png.height,
      width: png.width,
      data: new Uint8Array(png.data),
    });
    if (data) log(`Decoded QR data from image: ${data.substring(0, 80)}...`);
    return data ?? null;
  } catch (e) {
    log(`QR image decode failed: ${e}`);
    return null;
  }
}

/**
 * Capture the UPI QR code image from the payment iframe.
 * Saves to a local file, returns base64 for inline display,
 * and generates a Unicode text representation for clients that don't support images.
 *
 * Text art generation strategy:
 *   1. Try extracting UPI URL directly from iframe DOM (no extra deps needed)
 *   2. Fall back to decoding QR image with pngjs + @paulmillr/qr
 *   3. Re-render the URL as a compact Unicode text QR with the qrcode package
 */
async function captureQrCode(frame: import("playwright").Frame): Promise<{
  base64: string;
  filePath: string;
  textArt: string | null;
} | null> {
  let base64: string | null = null;
  let pngBuffer: Buffer | null = null;

  try {
    // Capture the QR image ---

    // Strategy 1: Screenshot the QR wrapper container
    const qrWrapper = frame.locator(SELECTORS.QR_WRAPPER).first();
    if (await qrWrapper.count() > 0 && await qrWrapper.isVisible().catch(() => false)) {
      pngBuffer = await qrWrapper.screenshot() as Buffer;
      base64 = pngBuffer.toString("base64");
      log("Captured QR code via element screenshot");
    }

    // Strategy 2: Extract the base64 data URL from the QR image element
    if (!base64) {
      const qrDataImg = frame.locator(SELECTORS.QR_DATA_IMAGE).first();
      if (await qrDataImg.count() > 0) {
        const src = await qrDataImg.getAttribute("src");
        if (src && src.startsWith("data:image/png;base64,")) {
          base64 = src.replace("data:image/png;base64,", "");
          pngBuffer = Buffer.from(base64, "base64");
          log("Captured QR code via data URL extraction");
        }
      }
    }

    // Strategy 3: Screenshot any visible canvas
    if (!base64) {
      const canvas = frame.locator(SELECTORS.CANVAS).first();
      if (await canvas.count() > 0 && await canvas.isVisible().catch(() => false)) {
        pngBuffer = await canvas.screenshot() as Buffer;
        base64 = pngBuffer.toString("base64");
        log("Captured QR code via canvas screenshot");
      }
    }

    if (!base64 || !pngBuffer) {
      log("Could not find QR code element to capture");
      return null;
    }

    // Save to local file
    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const dir = join(homedir(), ".blinkit-mcp");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = join(dir, "upi-qr-code.png");
    writeFileSync(filePath, pngBuffer);
    log(`QR code saved to ${filePath}`);

    // Generate text art QR ---

    // First try: extract UPI URL directly from iframe DOM (no decode deps needed)
    let qrData = await extractUpiUrl(frame);

    // Fallback: decode the QR image to extract the URL
    if (!qrData) {
      log("DOM extraction failed, falling back to QR image decode...");
      qrData = await decodeQrFromPng(pngBuffer);
    }

    let textArt: string | null = null;
    if (qrData) {
      try {
        textArt = await QRCode.toString(qrData, { type: "utf8" });
      } catch (e) {
        log(`QR text re-render failed: ${e}`);
      }
    }

    return { base64, filePath, textArt };
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
  let hasWidget = await page.locator(SELECTORS.PAYMENT_WIDGET).count() > 0;
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
    { name: "Wallets", type: "wallets", text: "Wallets", selector: SELECTORS.PAYMENT_WALLETS },
    { name: "Credit/Debit Cards", type: "card", text: "credit or debit", selector: SELECTORS.PAYMENT_CARD },
    { name: "Netbanking", type: "netbanking", text: "Netbanking", selector: SELECTORS.PAYMENT_NETBANKING },
    { name: "UPI", type: "upi", text: "UPI", selector: SELECTORS.PAYMENT_UPI },
    { name: "Cash on Delivery", type: "cod", text: "Cash", selector: SELECTORS.PAYMENT_CASH },
    { name: "Pay Later", type: "pay_later", text: "Pay Later", selector: SELECTORS.PAYMENT_PAY_LATER },
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
  qr_file_path?: string;
  qr_text_art?: string;
}> {
  log(`Selecting payment method: ${methodType}`);

  const frame = await getPaymentFrame(page);
  if (!frame) {
    throw new Error("Payment widget not found. Complete checkout first.");
  }

  // Map method types to selectors for finding the section header
  const methodMap: Record<string, { label: string; selector: string }> = {
    upi: { label: "UPI", selector: SELECTORS.PAYMENT_UPI },
    card: { label: "Credit/Debit Cards", selector: SELECTORS.PAYMENT_CARD },
    netbanking: { label: "Netbanking", selector: SELECTORS.PAYMENT_NETBANKING },
    wallets: { label: "Wallets", selector: SELECTORS.PAYMENT_WALLETS },
    cod: { label: "Cash", selector: SELECTORS.PAYMENT_CASH },
    pay_later: { label: "Pay Later", selector: SELECTORS.PAYMENT_PAY_LATER },
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
    const generateQr = frame.locator(SELECTORS.GENERATE_QR);
    if (await generateQr.count() > 0 && await generateQr.first().isVisible().catch(() => false)) {
      await generateQr.first().click();
      log("Clicked 'Generate QR' for UPI payment");
      await page.waitForTimeout(3000);
    }

    // Capture the QR code image, save to file, and generate text art
    const qrResult = await captureQrCode(frame);

    return {
      selected: true,
      message: "UPI selected. QR code generated.",
      action_needed: "Scan the QR code with your UPI app (Google Pay, PhonePe, Paytm) to complete payment.",
      qr_image_base64: qrResult?.base64,
      qr_file_path: qrResult?.filePath,
      qr_text_art: qrResult?.textArt ?? undefined,
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
  const payBtnOnPage = page.locator(SELECTORS.PAY_NOW_BUTTON).last();
  if (await payBtnOnPage.count() > 0 && await payBtnOnPage.isVisible().catch(() => false)) {
    await payBtnOnPage.click();
    log("Clicked 'Pay Now' on main page.");
    return { message: "Pay Now clicked. Complete payment on your device (approve UPI request or enter OTP for card)." };
  }

  // Strategy 2: Try inside iframe as fallback
  const frame = await getPaymentFrame(page, 5000);
  if (frame) {
    const frameBtn = frame.locator(SELECTORS.PAY_NOW_FRAME);
    if (await frameBtn.count() > 0 && await frameBtn.first().isVisible().catch(() => false)) {
      await frameBtn.first().click();
      log("Clicked 'Pay Now' inside payment iframe.");
      return { message: "Pay Now clicked. Complete payment on your device." };
    }
  }

  // Strategy 3: Try Zpayments-specific button
  const zpayBtn = page.locator(SELECTORS.ZPAYMENTS_PAY_NOW);
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
 */
export async function trackOrder(page: Page, orderId?: string): Promise<Record<string, unknown>> {
  const url = orderId
    ? `https://blinkit.com/order/${orderId}`
    : "https://blinkit.com/orders";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  if (!orderId) {
    try {
      await page.locator(SELECTORS.ORDER_CARD).first().click();
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
