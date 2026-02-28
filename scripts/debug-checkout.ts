#!/usr/bin/env tsx
/**
 * Diagnostic script: walks through the checkout flow step by step,
 * taking screenshots and logging page state at each stage.
 *
 * Usage: npx tsx scripts/debug-checkout.ts
 */

import { firefox } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STORAGE_STATE = join(homedir(), ".blinkit-mcp", "cookies", "auth.json");
const SCREENSHOT_DIR = join(homedir(), ".blinkit-mcp", "debug-screenshots");

async function screenshot(page: any, name: string) {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 Screenshot: ${path}`);
}

async function reportPageState(page: any, label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`  URL: ${page.url()}`);

  // Check for key elements
  const checks = [
    { name: "Login button", sel: "text='Login'" },
    { name: "Account text", sel: "text='Account'" },
    { name: "My Account", sel: "text='My Account'" },
    { name: "Cart button", sel: "div[class*='CartButton']" },
    { name: "Cart item count", sel: "div[class*='CartButton'] span, div[class*='CartButton'] div" },
    { name: "Proceed button", sel: "button:has-text('Proceed'), div:has-text('Proceed')" },
    { name: "Select delivery address", sel: "text='Select delivery address'" },
    { name: "Address list items", sel: "div[class*='AddressList__AddressItemWrapper'], div[class*='AddressCard']" },
    { name: "Payment widget (#payment_widget)", sel: "#payment_widget" },
    { name: "Pay Now button", sel: "text='Pay Now'" },
    { name: "Delivery tip section", sel: "text=/[Dd]elivery [Tt]ip/" },
    { name: "Proceed to Pay", sel: "text='Proceed to Pay'" },
    { name: "Store closed", sel: "text='Store is closed'" },
    { name: "Currently unavailable", sel: "text='Currently unavailable'" },
    { name: "Bill details", sel: "text=/Bill details/i" },
    { name: "UPI text", sel: "text=/UPI/i" },
    { name: "Checkout header", sel: "text=/[Cc]heckout/" },
    { name: "Order summary", sel: "text=/[Oo]rder [Ss]ummary/" },
    { name: "Delivery address", sel: "text=/[Dd]elivery [Aa]ddress/" },
  ];

  for (const { name, sel } of checks) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        let text = "";
        try {
          text = await page.locator(sel).first().innerText();
          text = text.trim().substring(0, 60);
        } catch { /* ignore */ }
        console.log(`  ✅ ${name}: ${count} found (visible: ${visible}) text="${text}"`);
      }
    } catch {
      // skip
    }
  }

  await screenshot(page, label.replace(/[^a-zA-Z0-9]/g, "_"));
}

async function isLoggedIn(page: any): Promise<boolean> {
  // Check for "Account" or "My Account" (logged in indicators)
  if (await page.isVisible("text='Account'").catch(() => false)) return true;
  if (await page.isVisible("text='My Account'").catch(() => false)) return true;
  // Negative: Login button means NOT logged in
  if (await page.isVisible("text='Login'").catch(() => false)) return false;
  // Unknown state — assume logged in if we have storage state
  return existsSync(STORAGE_STATE);
}

async function main() {
  console.log("Starting checkout flow diagnostic...\n");

  // Check for saved session
  if (!existsSync(STORAGE_STATE)) {
    console.error("No saved session found at", STORAGE_STATE);
    console.error("Please login first using the MCP tools.");
    process.exit(1);
  }

  const browser = await firefox.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
  });
  const page = await context.newPage();

  try {
    // Step 1: Navigate to blinkit.com
    console.log("Step 1: Navigating to blinkit.com...");
    await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await reportPageState(page, "01_homepage");

    // Step 2: Check if logged in
    const loggedIn = await isLoggedIn(page);
    console.log(`\nLogged in: ${loggedIn}`);

    if (!loggedIn) {
      console.log("Not logged in. Stopping.");
      await browser.close();
      return;
    }

    // Step 2b: Search for gatorade and add to cart (so we have something to checkout)
    console.log("\nStep 2b: Searching for 'gatorade'...");
    await page.goto("https://blinkit.com/s/?q=gatorade", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await reportPageState(page, "02_search_results");

    // Try to add first product
    const addBtn = page.locator("button:has-text('Add'), div:has-text('ADD')").first();
    if (await addBtn.isVisible().catch(() => false)) {
      console.log("  Clicking ADD on first product...");
      await addBtn.click();
      await page.waitForTimeout(2000);
      await reportPageState(page, "02b_after_add");
    } else {
      console.log("  No ADD button found. Checking if items already in cart...");
    }

    // Step 3: Open cart
    console.log("\nStep 3: Opening cart...");
    const cartBtn = page.locator("div[class*='CartButton']").first();
    if (await cartBtn.count() > 0 && await cartBtn.isVisible().catch(() => false)) {
      await cartBtn.click();
      await page.waitForTimeout(2000);
      await reportPageState(page, "03_cart_open");

      // Get all text in the cart drawer
      const cartDrawer = page.locator("div[class*='CartContainer'], div[class*='Cart__Container'], div[class*='SlideOver']");
      if (await cartDrawer.count() > 0) {
        const cartText = await cartDrawer.first().innerText().catch(() => "");
        console.log(`\n  Cart drawer text (first 500 chars):\n${cartText.substring(0, 500)}`);
      }
    } else {
      console.log("  No cart button visible.");
    }

    // Step 4: Click Proceed
    console.log("\nStep 4: Looking for Proceed button...");
    // Log ALL elements with "Proceed" text
    const allProceed = page.locator("button, div, a, span").filter({ hasText: /Proceed/ });
    const proceedCount = await allProceed.count();
    console.log(`  Found ${proceedCount} elements with 'Proceed' text:`);
    for (let i = 0; i < Math.min(proceedCount, 10); i++) {
      const text = await allProceed.nth(i).innerText().catch(() => "?");
      const vis = await allProceed.nth(i).isVisible().catch(() => false);
      const tag = await allProceed.nth(i).evaluate((el: any) => el.tagName).catch(() => "?");
      console.log(`    [${i}] <${tag}> visible=${vis} text="${text.trim().substring(0, 80)}"`);
    }

    const proceedBtn = page.locator("button, div").filter({ hasText: "Proceed" }).last();
    const proceedVisible = await proceedBtn.isVisible().catch(() => false);
    console.log(`\n  Using last Proceed (visible: ${proceedVisible})`);

    if (proceedVisible) {
      console.log("  Clicking Proceed...");
      await proceedBtn.click();
      await page.waitForTimeout(3000);
      console.log(`  URL after Proceed: ${page.url()}`);
      await reportPageState(page, "04_after_proceed");

      // Step 5: Check what appeared
      const hasAddressModal = await page.isVisible("text='Select delivery address'").catch(() => false);
      const hasPaymentWidget = await page.locator("#payment_widget").count() > 0;

      console.log(`\n  Address modal: ${hasAddressModal}`);
      console.log(`  Payment widget: ${hasPaymentWidget}`);

      if (hasAddressModal) {
        console.log("\nStep 5a: Address modal detected. Checking addresses...");
        // Try multiple selectors for address items
        const addrSelectors = [
          "div[class*='AddressList__AddressItemWrapper']",
          "div[class*='AddressCard']",
          "div[class*='address']",
          "div[class*='Address']",
        ];
        for (const sel of addrSelectors) {
          const count = await page.locator(sel).count();
          if (count > 0) {
            console.log(`  Selector "${sel}": ${count} matches`);
          }
        }

        // Click first address-like element
        const addresses = page.locator("div[class*='AddressList'], div[class*='AddressCard'], div[class*='address-item']");
        const addrCount = await addresses.count();
        console.log(`  Combined address elements: ${addrCount}`);

        // Try to find and click an address
        // Also dump the address selection area text
        const modalText = await page.locator("body").innerText().catch(() => "");
        const addressSection = modalText.split("Select delivery address")[1]?.substring(0, 500) ?? "";
        if (addressSection) {
          console.log(`  Address section text:\n${addressSection}`);
        }

        if (addrCount > 0) {
          console.log("  Clicking first address...");
          await addresses.first().click();
          await page.waitForTimeout(3000);
          console.log(`  URL after address select: ${page.url()}`);
          await reportPageState(page, "05_after_address_select");
        }
      }

      // Step 6: Try navigating forward through intermediate screens
      if (!hasPaymentWidget) {
        console.log("\nStep 6: Navigating through intermediate screens...");

        // Check for delivery tip
        const hasTip = await page.locator("text=/[Dd]elivery [Tt]ip/").count() > 0;
        if (hasTip) {
          console.log("  Delivery tip screen detected!");
          const noTip = page.locator("text=/[Nn]o [Tt]ip/, text=/[Ss]kip/");
          if (await noTip.count() > 0) {
            await noTip.first().click();
            console.log("  Clicked 'No tip' / 'Skip'");
            await page.waitForTimeout(2000);
          }
        }

        // Check for "Proceed to Pay"
        const hasProceedToPay = await page.isVisible("text='Proceed to Pay'").catch(() => false);
        if (hasProceedToPay) {
          console.log("  Found 'Proceed to Pay' button");
          await page.locator("text='Proceed to Pay'").click();
          await page.waitForTimeout(3000);
          console.log(`  URL after Proceed to Pay: ${page.url()}`);
        }

        await reportPageState(page, "06_after_navigation");

        // Check for payment widget again
        const hasWidgetNow = await page.locator("#payment_widget").count() > 0;
        console.log(`  Payment widget present now: ${hasWidgetNow}`);

        if (hasWidgetNow) {
          // Step 7: Examine payment widget iframe
          console.log("\nStep 7: Examining payment widget iframe...");
          const iframeEl = await page.waitForSelector("#payment_widget", { timeout: 10000 }).catch(() => null);
          if (iframeEl) {
            const frame = await iframeEl.contentFrame();
            if (frame) {
              await frame.waitForLoadState("networkidle").catch(() => {});
              const frameText = await frame.locator("body").innerText().catch(() => "");
              console.log(`  Iframe text (first 500 chars):\n${frameText.substring(0, 500)}`);

              // Look for UPI VPAs
              const vpaLocators = frame.locator("text=/@/");
              const vpaCount = await vpaLocators.count();
              console.log(`\n  VPA-like elements (containing @): ${vpaCount}`);
              for (let i = 0; i < vpaCount; i++) {
                const t = await vpaLocators.nth(i).innerText().catch(() => "?");
                console.log(`    VPA[${i}]: "${t}"`);
              }
            } else {
              console.log("  Could not access iframe content frame.");
            }
          }
        }
      }
    } else {
      console.log("  Proceed button not visible. Cart might be empty.");
      // Dump page text to see what's going on
      const bodyText = await page.locator("body").innerText().catch(() => "");
      console.log(`  Body text (first 300 chars): ${bodyText.substring(0, 300)}`);
    }

    // Final state
    console.log("\n\n=== FINAL STATE ===");
    await reportPageState(page, "99_final");

    // Keep browser open for 15 seconds for manual inspection
    console.log("\nBrowser staying open for 15 seconds for manual inspection...");
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error("Error:", error);
    await screenshot(page, "ERROR");
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);
}

main().catch(console.error);
