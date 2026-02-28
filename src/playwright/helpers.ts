import type { Page } from "playwright";

/** Module-level debug mode flag — set this to enable debug helpers */
export let debugMode = false;

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

// ─── Debug helpers ───────────────────────────────────────────────────────────

/** Highlight an element with a colored border in debug mode */
export async function debugHighlight(page: Page, selector: string, color = "red"): Promise<void> {
  if (!debugMode) return;
  try {
    await page.evaluate(
      ({ sel, col }: { sel: string; col: string }) => {
        const el = (globalThis as any).document.querySelector(sel);
        if (el) el.style.outline = `3px solid ${col}`;
      },
      { sel: selector, col: color }
    );
  } catch {
    // ignore
  }
}

/** Log + pause briefly in debug mode so you can see what's happening */
export async function debugStep(page: Page, label: string): Promise<void> {
  if (!debugMode) return;
  log(`[DEBUG] ${label}`);
  await page.waitForTimeout(800);
}

// ─── Shared page helpers ─────────────────────────────────────────────────────

/** Check if user is logged in by looking at UI state */
export async function checkLoggedIn(page: Page): Promise<boolean> {
  try {
    // Positive indicators -- these confirm the user IS logged in
    // Blinkit shows "Account" (not "My Account") in the header when logged in
    if (await page.isVisible("text='My Account'").catch(() => false)) return true;
    if (await page.isVisible("text='Account'").catch(() => false)) return true;
    if (await page.isVisible(".user-profile").catch(() => false)) return true;
    if (await page.locator("div[class*='ProfileButton'], div[class*='AccountButton'], div[class*='UserProfile']")
      .first().isVisible({ timeout: 1000 }).catch(() => false)) return true;

    // Negative indicator -- if Login button IS visible, user is definitely NOT logged in
    const loginVisible = await page.isVisible("text='Login'").catch(() => false);
    if (loginVisible) return false;

    // If neither positive nor negative indicators found (e.g., overlay blocking, page loading),
    // default to not logged in to avoid false positives
    return false;
  } catch {
    return false;
  }
}

/** Check if store is closed or unavailable */
export async function isStoreClosed(page: Page): Promise<string | false> {
  try {
    if (await page.isVisible("text='Store is closed'").catch(() => false)) {
      return "Store is closed.";
    }
    if (await page.isVisible("text=\"Sorry, can't take your order\"").catch(() => false)) {
      return "Sorry, can't take your order. Store is unavailable.";
    }
    if (await page.isVisible("text='Currently unavailable'").catch(() => false)) {
      return "Store is currently unavailable at this location.";
    }
    if (await page.isVisible("text='High Demand'").catch(() => false)) {
      return "Store is experiencing high demand. Please try again later.";
    }
  } catch {
    // ignore
  }
  return false;
}

/** Navigate through intermediate checkout screens (tip, proceed to pay, etc.) until payment widget appears */
export async function navigateToPaymentWidget(page: Page, timeoutMs = 20000): Promise<{
  reached: boolean;
  skippedSteps: string[];
}> {
  const skippedSteps: string[] = [];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check if payment widget is already present
    if (await page.locator("#payment_widget").count() > 0) {
      return { reached: true, skippedSteps };
    }

    // Check for delivery tip screen
    const tipSection = page.locator("text=/[Dd]elivery [Tt]ip/, text=/[Aa]dd [Tt]ip/, text=/[Tt]ip your delivery/");
    if (await tipSection.count() > 0) {
      log("Detected delivery tip screen. Looking for skip/proceed option...");
      // Try "No tip" or "Skip" first
      const noTip = page.locator("text=/[Nn]o [Tt]ip/, text=/[Ss]kip/");
      if (await noTip.count() > 0) {
        await noTip.first().click();
        skippedSteps.push("delivery_tip_skipped");
        await page.waitForTimeout(1000);
        continue;
      }
      // Fallback: look for Proceed/Continue button
      const proceedBtn = page.locator("button, div").filter({ hasText: /Proceed|Continue|Next/ }).last();
      if (await proceedBtn.isVisible().catch(() => false)) {
        await proceedBtn.click();
        skippedSteps.push("delivery_tip_proceeded");
        await page.waitForTimeout(1000);
        continue;
      }
    }

    // Check for "Proceed to Pay" / "Proceed to Payment" button
    const proceedToPay = page.locator(
      "button:has-text('Proceed to Pay'), div:has-text('Proceed to Pay'), " +
      "button:has-text('Proceed to Payment'), button:has-text('Continue to Payment')"
    );
    if (await proceedToPay.count() > 0 && await proceedToPay.last().isVisible().catch(() => false)) {
      await proceedToPay.last().click();
      skippedSteps.push("proceed_to_pay_clicked");
      log("Clicked 'Proceed to Pay'");
      await page.waitForTimeout(2000);
      continue;
    }

    // Check for generic "Proceed" or "Continue" button (fallback)
    const genericProceed = page.locator("button, div").filter({ hasText: /^Proceed$|^Continue$|^Next$/ }).last();
    if (await genericProceed.isVisible().catch(() => false)) {
      await genericProceed.click();
      skippedSteps.push("generic_proceed_clicked");
      log("Clicked generic Proceed/Continue button");
      await page.waitForTimeout(1500);
      continue;
    }

    // Check for dismissible overlays/modals
    const closeBtn = page.locator("button[aria-label='close'], button[aria-label='Close'], div[class*='close']");
    if (await closeBtn.count() > 0 && await closeBtn.first().isVisible().catch(() => false)) {
      await closeBtn.first().click();
      skippedSteps.push("modal_dismissed");
      await page.waitForTimeout(500);
      continue;
    }

    await page.waitForTimeout(500);
  }

  return { reached: false, skippedSteps };
}

/** Extract numeric price from a text string like "₹199" or "199.50" */
export function extractPrice(text: string | null): number {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

// ─── Generic utility helpers (preserved from original) ───────────────────────

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
