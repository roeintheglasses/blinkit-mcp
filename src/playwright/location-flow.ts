import type { Page } from "playwright";
import { debugStep, isStoreClosed, navigateToPaymentWidget } from "./helpers.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

/**
 * Set delivery location by searching for an address query.
 */
export async function setLocation(
  page: Page,
  params: { addressQuery?: string; lat?: number; lon?: number }
): Promise<{ location_set: boolean; warning?: string }> {
  const locationName = params.addressQuery;

  if (!locationName) {
    throw new Error("No location name provided");
  }

  await debugStep(page, `Setting location to: ${locationName}`);

  // Check if location input modal is already open
  if (!await page.isVisible("input[name='select-locality']").catch(() => false)) {
    // Click location bar to open modal
    if (await page.isVisible("div[class*='LocationBar__Container']")) {
      await page.click("div[class*='LocationBar__Container']");
    }

    // Wait for location input
    await page.waitForSelector(
      "input[name='select-locality'], input[placeholder*='search delivery location']",
      { state: "visible", timeout: 30000 }
    );
  }

  const locInput = page.locator("input[name='select-locality'], input[placeholder*='search delivery location']").first();
  await locInput.fill(locationName);
  await page.waitForTimeout(1000);

  // Select first result
  const firstResult = page.locator("div[class*='LocationSearchBox__LocationItemContainer']").first();
  if (await firstResult.isVisible().catch(() => false)) {
    await firstResult.click();
    log("Selected first location result.");
  } else {
    log("No location results found.");
  }

  // Wait for location update
  await page.waitForTimeout(2000);

  // Check if new location is unavailable
  if (await page.isVisible("text='Currently unavailable'").catch(() => false)) {
    return { location_set: true, warning: "Store is marked as 'Currently unavailable' at this location." };
  }

  return { location_set: true };
}

/**
 * Get saved addresses from the address selection modal.
 * The modal must already be visible (typically after checkout).
 */
export async function getAddresses(page: Page): Promise<{
  addresses: Array<{ index: number; label: string; address_line: string; is_default: boolean }>;
  hint?: string;
}> {
  // Check store status
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    throw new Error(`CRITICAL: ${storeStatus}`);
  }

  // Check if address selection modal is visible
  if (!await page.isVisible("text='Select delivery address'").catch(() => false)) {
    log("Address selection modal not visible.");
    return {
      addresses: [],
      hint: "Address modal not open. Try checkout first, or click the location bar.",
    };
  }

  log("Address modal detected. Parsing addresses...");
  const addresses: Array<{ index: number; label: string; address_line: string; is_default: boolean }> = [];
  const items = page.locator("div[class*='AddressList__AddressItemWrapper']");
  const itemCount = await items.count();

  for (let i = 0; i < itemCount; i++) {
    try {
      const item = items.nth(i);
      const labelEl = item.locator("div[class*='AddressList__AddressLabel']");
      const detailsEl = item.locator("div[class*='AddressList__AddressDetails']").last();

      const label = await labelEl.count() > 0 ? await labelEl.innerText() : "Unknown";
      const details = await detailsEl.count() > 0 ? await detailsEl.innerText() : "";

      addresses.push({
        index: i,
        label: label.trim(),
        address_line: details.trim(),
        is_default: i === 0,
      });
    } catch {
      // Skip
    }
  }

  return { addresses };
}

/**
 * Select an address by index from the address selection modal.
 * Navigates through intermediate screens (tip, proceed to pay) after selection.
 */
export async function selectAddress(
  page: Page,
  index: number
): Promise<{ selected: boolean; payment_ready: boolean; skipped_steps: string[]; hint: string }> {
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    throw new Error(`CRITICAL: ${storeStatus}`);
  }

  const items = page.locator("div[class*='AddressList__AddressItemWrapper']");
  if (index >= await items.count()) {
    throw new Error(`Invalid address index: ${index}`);
  }

  await items.nth(index).click();
  log(`Clicked address at index ${index}. Navigating through intermediate steps...`);
  await page.waitForTimeout(1500);

  // Navigate through any intermediate screens (tip, proceed to pay, etc.)
  const navResult = await navigateToPaymentWidget(page, 15000);

  return {
    selected: true,
    payment_ready: navResult.reached,
    skipped_steps: navResult.skippedSteps,
    hint: navResult.reached
      ? "Address selected and payment page reached. Use get_upi_ids to see payment options."
      : "Address selected but payment page not yet reached. There may be additional steps on screen.",
  };
}
