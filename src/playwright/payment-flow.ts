import type { Page } from "playwright";
import { navigateToPaymentWidget } from "./helpers.ts";
import { SELECTORS } from "./selectors.ts";
import { getPaymentFrame, captureQrCode } from "./qr-helpers.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
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
  const hasWidget = await page.locator(SELECTORS.PAYMENT_WIDGET).count() > 0;
  if (!hasWidget) {
    log("Payment widget not visible. Trying to navigate to it...");
    await navigateToPaymentWidget(page, 15000);
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
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Handle method-specific behavior
  if (methodType.toLowerCase() === "upi") {
    // Check for "Generate QR" button
    const generateQr = frame.locator(SELECTORS.GENERATE_QR);
    if (await generateQr.count() > 0 && await generateQr.first().isVisible().catch(() => false)) {
      await generateQr.first().click();
      log("Clicked 'Generate QR' for UPI payment");
      await frame.waitForSelector(SELECTORS.QR_WRAPPER + ', ' + SELECTORS.QR_DATA_IMAGE + ', ' + SELECTORS.CANVAS, { timeout: 10000 }).catch(() => null);
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
