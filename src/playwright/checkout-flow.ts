import type { Page } from "playwright";
import { isStoreClosed, navigateToPaymentWidget } from "./helpers.ts";
import { SELECTORS } from "./selectors.ts";

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
      await cartBtn.first().click();
      log("Clicked cart button.");
      await page.waitForSelector(SELECTORS.PROCEED_HAS_TEXT, { timeout: 5000 }).catch(() => null);
    } else {
      log("Could not find cart button.");
    }
  }

  // Try clicking Proceed
  if (await proceedBtn.isVisible().catch(() => false)) {
    await proceedBtn.click();
    log("Cart checkout initiated.");
    await Promise.race([
      page.waitForSelector(SELECTORS.SELECT_DELIVERY_ADDRESS, { timeout: 10000 }),
      page.waitForSelector(SELECTORS.PAYMENT_WIDGET, { timeout: 10000 }),
    ]).catch(() => null);

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
