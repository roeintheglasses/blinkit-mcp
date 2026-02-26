import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import { waitAndClick, waitAndFill, extractNumber } from "./helpers.ts";
import { BLINKIT_BASE_URL } from "../constants.ts";
import type { Address } from "../types.ts";

export async function setLocationByQuery(page: Page, query: string): Promise<boolean> {
  await page.goto(BLINKIT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  try {
    // Click location bar to open location search
    await waitAndClick(page, SELECTORS.LOCATION_BAR, 10000);
    await page.waitForTimeout(1000);

    // Type in the location query
    await waitAndFill(page, SELECTORS.LOCATION_INPUT, query, 5000);
    await page.waitForTimeout(2000);

    // Click first suggestion
    await waitAndClick(page, SELECTORS.LOCATION_SUGGESTION, 5000);
    await page.waitForTimeout(2000);

    return true;
  } catch {
    return false;
  }
}

export async function getSavedAddresses(page: Page): Promise<Address[]> {
  await page.goto(BLINKIT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Open location/address picker
  try {
    await waitAndClick(page, SELECTORS.LOCATION_BAR, 10000);
    await page.waitForTimeout(2000);
  } catch {
    // Location bar might already be open
  }

  const addresses: Address[] = [];
  const items = page.locator(SELECTORS.ADDRESS_LIST);
  const count = await items.count();

  for (let i = 0; i < count; i++) {
    try {
      const item = items.nth(i);
      const label = await item.locator(SELECTORS.ADDRESS_LABEL).textContent().catch(() => null);
      const line = await item.locator(SELECTORS.ADDRESS_LINE).textContent().catch(() => null);

      addresses.push({
        index: i,
        label: label?.trim() ?? `Address ${i + 1}`,
        address_line: line?.trim() ?? "",
        is_default: i === 0,
      });
    } catch {
      // Skip
    }
  }

  return addresses;
}

export async function selectAddress(page: Page, index: number): Promise<boolean> {
  await page.goto(BLINKIT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  try {
    await waitAndClick(page, SELECTORS.LOCATION_BAR, 10000);
    await page.waitForTimeout(2000);

    const items = page.locator(SELECTORS.ADDRESS_LIST);
    const count = await items.count();

    if (index >= count) {
      return false;
    }

    await items.nth(index).click();
    await page.waitForTimeout(2000);
    return true;
  } catch {
    return false;
  }
}
