#!/usr/bin/env node
/**
 * Playwright Bridge — runs as a separate Node.js process.
 * Communicates with the main Bun MCP server via JSON messages over stdin/stdout.
 *
 * This separation is necessary because Playwright has known incompatibilities
 * with Bun (segfaults, child process issues).
 */

import { firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

interface BridgeCommand {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

interface BridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let debugMode = false;
let storageStatePath: string | null = null;

// Known products tracking for cross-search cart recovery
const knownProducts = new Map<string, { sourceQuery: string; name: string }>();
let currentQuery = "";

function respond(response: BridgeResponse): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

function log(message: string): void {
  process.stderr.write(`[bridge] ${message}\n`);
}

/** Highlight an element with a colored border in debug mode */
async function debugHighlight(p: Page, selector: string, color = "red"): Promise<void> {
  if (!debugMode) return;
  try {
    await p.evaluate(
      ({ sel, col }) => {
        const el = document.querySelector(sel);
        if (el) (el as HTMLElement).style.outline = `3px solid ${col}`;
      },
      { sel: selector, col: color }
    );
  } catch {
    // ignore
  }
}

/** Log + pause briefly in debug mode so you can see what's happening */
async function debugStep(p: Page, label: string): Promise<void> {
  if (!debugMode) return;
  log(`[DEBUG] ${label}`);
  await p.waitForTimeout(800);
}

/** Check if store is closed or unavailable */
async function isStoreClosed(p: Page): Promise<string | false> {
  try {
    if (await p.isVisible("text='Store is closed'").catch(() => false)) {
      return "Store is closed.";
    }
    if (await p.isVisible("text=\"Sorry, can't take your order\"").catch(() => false)) {
      return "Sorry, can't take your order. Store is unavailable.";
    }
    if (await p.isVisible("text='Currently unavailable'").catch(() => false)) {
      return "Store is currently unavailable at this location.";
    }
    if (await p.isVisible("text='High Demand'").catch(() => false)) {
      return "Store is experiencing high demand. Please try again later.";
    }
  } catch {
    // ignore
  }
  return false;
}

/** Save storage state to file for session persistence */
async function saveStorageState(): Promise<void> {
  if (!context || !storageStatePath) return;
  try {
    const dir = dirname(storageStatePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    await context.storageState({ path: storageStatePath });
    log(`Session saved to ${storageStatePath}`);
  } catch (e) {
    log(`Failed to save storage state: ${e}`);
  }
}

/** Check if user is logged in by looking at UI state */
async function checkLoggedIn(p: Page): Promise<boolean> {
  try {
    // Positive indicators — these confirm the user IS logged in
    if (await p.isVisible("text='My Account'").catch(() => false)) return true;
    if (await p.isVisible(".user-profile").catch(() => false)) return true;
    if (await p.locator("div[class*='ProfileButton'], div[class*='AccountButton'], div[class*='UserProfile']")
      .first().isVisible({ timeout: 1000 }).catch(() => false)) return true;

    // Negative indicator — if Login button IS visible, user is definitely NOT logged in
    const loginVisible = await p.isVisible("text='Login'").catch(() => false);
    if (loginVisible) return false;

    // If neither positive nor negative indicators found (e.g., overlay blocking, page loading),
    // default to not logged in to avoid false positives
    return false;
  } catch {
    return false;
  }
}

function extractPrice(text: string | null): number {
  if (!text) return 0;
  return parseFloat(text.replace(/[^0-9.]/g, "")) || 0;
}

async function ensurePage(): Promise<Page> {
  if (!browser || !context || !page) {
    throw new Error("Browser not initialized. Send 'init' command first.");
  }
  if (page.isClosed()) {
    page = await context.newPage();
  }
  return page;
}

/** Re-search for a product using known query (for cart recovery) */
async function reSearchProduct(p: Page, sourceQuery: string): Promise<void> {
  log(`Re-searching for products from query: "${sourceQuery}"`);

  // Activate search
  if (await p.isVisible("a[href='/s/']")) {
    await p.click("a[href='/s/']");
  } else if (await p.isVisible("div[class*='SearchBar__PlaceholderContainer']")) {
    await p.click("div[class*='SearchBar__PlaceholderContainer']");
  } else if (await p.isVisible("input[placeholder*='Search']")) {
    await p.click("input[placeholder*='Search']");
  } else {
    try {
      await p.click("text='Search'", { timeout: 3000 });
    } catch {
      await p.goto(`https://blinkit.com/s/?q=${encodeURIComponent(sourceQuery)}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await p.waitForTimeout(2000);
      return;
    }
  }

  try {
    const searchInput = await p.waitForSelector(
      "input[placeholder*='Search'], input[type='text']",
      { state: "visible", timeout: 15000 }
    );
    if (searchInput) {
      await searchInput.fill(sourceQuery);
      await p.waitForTimeout(300);
      await p.keyboard.press("Enter");
    }
  } catch {
    log("Search input not found during re-search");
  }

  // Wait for results
  try {
    await p.waitForSelector("div[role='button']:has-text('ADD')", { timeout: 30000 });
  } catch {
    log("No product cards found during re-search");
  }
  await p.waitForTimeout(1000);
}

async function handleCommand(command: BridgeCommand): Promise<void> {
  const { id, action, params } = command;

  try {
    switch (action) {
      case "init": {
        const headless = params.headless !== false;
        const slowMo = (params.slowMo as number) || 0;
        debugMode = (params.debug as boolean) || false;
        const lat = (params.lat as number) || 28.6139;
        const lon = (params.lon as number) || 77.209;
        storageStatePath = (params.storageStatePath as string) || null;

        log(`Initializing browser (headless=${headless}, debug=${debugMode}, slowMo=${slowMo}, lat=${lat}, lon=${lon})`);

        browser = await firefox.launch({ headless, slowMo });

        const contextOptions: any = {
          userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
          viewport: { width: 1280, height: 800 },
          permissions: ["geolocation"],
          geolocation: { latitude: lat, longitude: lon },
        };

        // Restore session if storage state file exists
        if (storageStatePath && existsSync(storageStatePath)) {
          log(`Loading session from ${storageStatePath}`);
          contextOptions.storageState = storageStatePath;
        }

        try {
          context = await browser.newContext(contextOptions);
        } catch (e) {
          log(`Failed to create context with storage state: ${e}, trying without`);
          delete contextOptions.storageState;
          context = await browser.newContext(contextOptions);
        }

        // Monitor payment-related network responses
        context.on("response", async (response) => {
          try {
            const url = response.url();
            if (url.includes("zpaykit") || url.includes("payment")) {
              if (response.status() >= 400) {
                log(`Payment API Error ${response.status()} at ${url}`);
              }
              const contentType = response.headers()["content-type"] || "";
              if (contentType.includes("application/json")) {
                try {
                  const data = await response.json();
                  if (data && (data.status === "failed" || data.error)) {
                    log(`Payment API Failure: ${JSON.stringify(data)}`);
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }
          } catch {
            // ignore
          }
        });

        page = await context.newPage();

        try {
          await page.goto("https://blinkit.com", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          log("Opened blinkit.com");
        } catch (e) {
          log(`Warning: Navigation to Blinkit took too long or failed: ${e}. Proceeding.`);
        }

        // Handle "Detect my location" popup (simple approach from reference)
        try {
          const locationBtn = page.locator("button").filter({ hasText: "Detect my location" });
          try {
            await locationBtn.waitFor({ state: "visible", timeout: 3000 });
            log("Location popup detected. Clicking 'Detect my location'...");
            await locationBtn.click();
            await locationBtn.waitFor({ state: "hidden", timeout: 5000 });
            log("Location popup dismissed.");
          } catch {
            // Timed out — popup didn't appear or already handled
          }
        } catch (e) {
          log(`Note: Error checking location popup: ${e}`);
        }

        // Check for global unavailability
        const storeStatus = await isStoreClosed(page);
        if (storeStatus) {
          log(`WARNING: ${storeStatus}`);
        }

        respond({ id, success: true });
        break;
      }

      case "isAlive": {
        respond({ id, success: true, data: { alive: true } });
        break;
      }

      case "isLoggedIn": {
        const p = await ensurePage();
        const loggedIn = await checkLoggedIn(p);
        respond({ id, success: true, data: { loggedIn } });
        break;
      }

      case "saveSession": {
        await saveStorageState();
        respond({ id, success: true });
        break;
      }

      case "login": {
        const p = await ensurePage();
        const phoneNumber = params.phoneNumber as string;

        await debugStep(p, "Navigating to blinkit.com");

        // Check if already on blinkit
        if (!p.url().includes("blinkit.com")) {
          await p.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
          await p.waitForTimeout(2000);
        }

        // Click Login button — try multiple strategies
        await debugStep(p, "Looking for Login button");
        if (await p.isVisible("text='Login'")) {
          await debugStep(p, "Clicking Login text button");
          await p.click("text='Login'");
        } else if (await p.isVisible("div[class*='ProfileButton__Container']")) {
          await debugStep(p, "Clicking ProfileButton container");
          await p.locator("div[class*='ProfileButton__Container']").click();
        } else {
          log("Login button not found, checking if already on login screen");
        }
        await p.waitForTimeout(1000);

        // Wait for phone input
        await debugStep(p, "Waiting for phone number input");
        const phoneInput = await p.waitForSelector(
          "input[type='tel'], input[name='mobile'], input[type='text']",
          { state: "visible", timeout: 30000 }
        );
        if (phoneInput) {
          await debugStep(p, `Filling phone number: ${phoneNumber}`);
          await phoneInput.click();
          await phoneInput.fill(phoneNumber);
          await p.waitForTimeout(500);

          // Submit
          await debugStep(p, "Submitting phone number");
          if (await p.isVisible("text='Next'")) {
            await p.click("text='Next'");
          } else if (await p.isVisible("text='Continue'")) {
            await p.click("text='Continue'");
          } else {
            await p.keyboard.press("Enter");
          }
          await p.waitForTimeout(2000);
        }

        respond({ id, success: true, data: { message: "OTP sent" } });
        break;
      }

      case "enterOtp": {
        const p = await ensurePage();
        const otp = params.otp as string;

        await debugStep(p, "Waiting for OTP input fields");
        await p.waitForSelector("input", { timeout: 30000 });
        const inputs = p.locator("input");
        const count = await inputs.count();

        if (count >= 4) {
          await debugStep(p, "Filling 4-digit OTP inputs");
          const otpInputs = p.locator("input[inputmode='numeric']");
          const otpCount = await otpInputs.count();
          if (otpCount >= 4) {
            for (let i = 0; i < 4; i++) {
              await otpInputs.nth(i).fill(otp[i]);
              await p.waitForTimeout(100);
            }
          } else {
            for (let i = 0; i < Math.min(4, count); i++) {
              await inputs.nth(i).fill(otp[i]);
              await p.waitForTimeout(100);
            }
          }
        } else {
          await debugStep(p, "Filling single OTP input");
          const otpInput = p.locator("input[data-test-id='otp-input'], input[name*='otp'], input[id*='otp']").first();
          if (await otpInput.isVisible().catch(() => false)) {
            await otpInput.fill(otp);
          } else {
            await p.fill("input", otp);
          }
        }

        await debugStep(p, "Submitting OTP");
        await p.keyboard.press("Enter");
        await p.waitForTimeout(5000);
        await p.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

        // Check login via UI state
        const loggedIn = await checkLoggedIn(p);
        log(`OTP verification: loggedIn=${loggedIn}`);

        // Save session if logged in
        if (loggedIn) {
          await saveStorageState();
        }

        respond({
          id,
          success: true,
          data: { logged_in: loggedIn },
        });
        break;
      }

      case "search": {
        const p = await ensurePage();
        const query = params.query as string;
        const limit = (params.limit as number) || 10;
        currentQuery = query;

        await debugStep(p, `Searching for: "${query}"`);

        // Navigate to blinkit home first if not already there
        if (!p.url().includes("blinkit.com")) {
          await p.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
          await p.waitForTimeout(2000);
        }

        // 1. Activate Search — use search bar UI flow (reference impl)
        await debugStep(p, "Activating search bar");
        if (await p.isVisible("a[href='/s/']")) {
          await p.click("a[href='/s/']");
        } else if (await p.isVisible("div[class*='SearchBar__PlaceholderContainer']")) {
          await p.click("div[class*='SearchBar__PlaceholderContainer']");
        } else if (await p.isVisible("input[placeholder*='Search']")) {
          await p.click("input[placeholder*='Search']");
        } else {
          try {
            await p.click("text='Search'", { timeout: 3000 });
          } catch {
            log("Search bar not found, navigating directly to search URL");
            await p.goto(`https://blinkit.com/s/?q=${encodeURIComponent(query)}`, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
            await p.waitForTimeout(2000);
          }
        }

        // 2. Type and Submit
        await debugStep(p, `Typing search query: "${query}"`);
        try {
          const searchInput = await p.waitForSelector(
            "input[placeholder*='Search'], input[type='text']",
            { state: "visible", timeout: 30000 }
          );
          if (searchInput) {
            await searchInput.fill(query);
            await p.waitForTimeout(300);
            await debugStep(p, "Pressing Enter to search");
            await p.keyboard.press("Enter");
          }
        } catch (e) {
          log(`Search input not found, may have used direct URL: ${e}`);
        }

        // 3. Wait for results
        await debugStep(p, "Waiting for search results");
        let noResults = false;
        try {
          await p.waitForSelector("div[role='button']:has-text('ADD')", { timeout: 30000 });
          log("Search results loaded.");
        } catch {
          log("Timed out waiting for product cards. Checking for 'No results'...");
          if (await p.isVisible("text='No results found'").catch(() => false) ||
              await p.isVisible("text=/no results/i").catch(() => false)) {
            log("No results found for this query.");
            noResults = true;
          } else {
            log("Could not detect standard product cards.");
          }
        }
        await p.waitForTimeout(1000);

        if (noResults) {
          respond({ id, success: true, data: { products: [], no_results: true } });
          break;
        }

        // 4. Parse results — div[role='button'] filtered by ADD and ₹ (reference impl)
        await debugStep(p, "Extracting product data from cards");
        const products: Array<Record<string, unknown>> = [];
        const cards = p.locator("div[role='button']").filter({ hasText: "ADD" }).filter({ hasText: "₹" });
        const cardCount = Math.min(await cards.count(), limit);
        log(`Found ${cardCount} product cards.`);

        for (let i = 0; i < cardCount; i++) {
          try {
            const card = cards.nth(i);
            const textContent = await card.innerText();

            // Extract ID from card's id attribute
            const productId = await card.getAttribute("id") ?? `unknown-${i}`;

            // Extract Name — use line-clamp-2 (reference impl)
            const nameLocator = card.locator("div[class*='line-clamp-2']");
            let name = "Unknown Product";
            if (await nameLocator.count() > 0) {
              name = (await nameLocator.first().innerText()).trim();
            } else {
              const broadNameLocator = card.locator("div[class*='line-clamp']");
              if (await broadNameLocator.count() > 0) {
                name = (await broadNameLocator.first().innerText()).trim();
              } else {
                const lines = textContent.split("\n").filter((l: string) => l.trim());
                name = lines[0] ?? "Unknown Product";
              }
            }

            // Store in known products for cart recovery
            if (productId !== `unknown-${i}`) {
              knownProducts.set(productId, { sourceQuery: currentQuery, name });
            }

            // Extract Price as raw string (reference impl)
            let priceStr = "Unknown Price";
            let priceNum = 0;
            if (textContent.includes("₹")) {
              for (const part of textContent.split("\n")) {
                if (part.includes("₹")) {
                  priceStr = part.trim();
                  priceNum = extractPrice(part);
                  break;
                }
              }
            }

            // Extract weight/unit
            const weightLocator = card.locator("div[class*='plp-product__quantity'], div[class*='Weight']");
            const unit = await weightLocator.first().innerText().catch(() => "");

            const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);

            if (debugMode) {
              await debugHighlight(p, `div[id='${productId}']`, "blue");
            }

            products.push({
              index: i,
              id: productId,
              name,
              price: priceNum,
              price_display: priceStr,
              mrp: priceNum,
              unit: unit.trim(),
              in_stock: true,
              image_url: imgSrc ?? "",
            });
          } catch (e) {
            log(`Error parsing card ${i}: ${e}`);
          }
        }

        respond({ id, success: true, data: { products } });
        break;
      }

      case "getProductDetails": {
        const p = await ensurePage();
        const productId = params.productId as string;

        await p.goto(`https://blinkit.com/prn/product/prid/${productId}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await p.waitForTimeout(2000);

        const name = await p.locator("h1, [class*='ProductName']").first().textContent().catch(() => null);
        const priceText = await p.locator("[class*='Price'], [class*='price']").first().textContent().catch(() => null);
        const description = await p.locator("[class*='Description'], [class*='description']").first().textContent().catch(() => null);
        const brand = await p.locator("[class*='Brand'], [class*='brand']").first().textContent().catch(() => null);

        const images: string[] = [];
        const imgs = p.locator("img[class*='product'], img[class*='Product']");
        const imgCount = await imgs.count();
        for (let j = 0; j < imgCount; j++) {
          const src = await imgs.nth(j).getAttribute("src").catch(() => null);
          if (src) images.push(src);
        }

        respond({
          id,
          success: true,
          data: {
            id: productId,
            name: name?.trim() ?? "Unknown",
            price: extractPrice(priceText),
            mrp: extractPrice(priceText),
            description: description?.trim() ?? null,
            brand: brand?.trim() ?? null,
            images,
            in_stock: true,
          },
        });
        break;
      }

      case "browseCategories": {
        const p = await ensurePage();
        await p.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
        await p.waitForTimeout(2000);

        const categories: Array<{ id: string; name: string; icon_url?: string }> = [];
        const categoryLinks = p.locator("a[href*='/cn/']");
        const catCount = await categoryLinks.count();

        for (let i = 0; i < catCount; i++) {
          try {
            const link = categoryLinks.nth(i);
            const name = await link.textContent().catch(() => null);
            const href = await link.getAttribute("href").catch(() => null);
            const img = await link.locator("img").first().getAttribute("src").catch(() => null);
            const idMatch = href?.match(/\/cn\/([^/]+)/);
            if (name && idMatch) {
              categories.push({
                id: idMatch[1],
                name: name.trim(),
                icon_url: img ?? undefined,
              });
            }
          } catch {
            // Skip
          }
        }

        respond({ id, success: true, data: { categories } });
        break;
      }

      case "browseCategory": {
        const p = await ensurePage();
        const categoryId = params.categoryId as string;
        const limit = (params.limit as number) || 20;

        await p.goto(`https://blinkit.com/cn/${categoryId}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await p.waitForTimeout(2000);

        try {
          await p.waitForSelector("div[role='button']:has-text('ADD')", { timeout: 15000 });
        } catch {
          // No products found
        }

        const products: Array<Record<string, unknown>> = [];
        const cards = p.locator("div[role='button']").filter({ hasText: "ADD" }).filter({ hasText: "₹" });
        const cardCount = Math.min(await cards.count(), limit);

        for (let i = 0; i < cardCount; i++) {
          try {
            const card = cards.nth(i);
            const textContent = await card.innerText();
            const productId = await card.getAttribute("id") ?? `product-${i}`;

            const nameLocator = card.locator("div[class*='line-clamp']");
            let name = "Unknown";
            if (await nameLocator.count() > 0) {
              name = (await nameLocator.first().innerText()).trim();
            } else {
              const lines = textContent.split("\n").filter((l: string) => l.trim());
              name = lines[0] ?? "Unknown";
            }

            let price = 0;
            for (const part of textContent.split("\n")) {
              if (part.includes("₹")) {
                price = extractPrice(part);
                break;
              }
            }

            const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);

            products.push({
              id: productId,
              name,
              price,
              mrp: price,
              unit: "",
              in_stock: true,
              image_url: imgSrc ?? "",
            });
          } catch {
            // Skip
          }
        }

        respond({ id, success: true, data: { products } });
        break;
      }

      case "addToCart": {
        const p = await ensurePage();
        const productId = params.productId as string;
        const quantity = (params.quantity as number) || 1;

        // Check store availability first
        const storeStatus = await isStoreClosed(p);
        if (storeStatus) {
          respond({ id, success: false, error: `CRITICAL: ${storeStatus}` });
          break;
        }

        // Target the specific product card by its ID attribute
        let card = p.locator(`div[id='${productId}']`);

        if (await card.count() === 0) {
          log(`Product ${productId} not found on current page.`);

          // Check known products for recovery via re-search
          const known = knownProducts.get(productId);
          if (known?.sourceQuery) {
            log(`Product found in history. Re-searching for '${known.sourceQuery}'...`);
            await reSearchProduct(p, known.sourceQuery);

            // Re-locate the card after search
            card = p.locator(`div[id='${productId}']`);
            if (await card.count() === 0) {
              log(`CRITICAL: Product ${productId} still not found after re-search.`);
              respond({ id, success: false, error: `Product ${productId} not found after re-search` });
              break;
            }
          } else {
            log("Product ID unknown and not on current page.");
            respond({ id, success: false, error: `Product ${productId} not found on page and not in search history` });
            break;
          }
        }

        try {
          // Find the ADD button inside the card
          const addBtn = card.locator("div").filter({ hasText: "ADD" }).last();
          let itemsToAdd = quantity;

          // If ADD button is visible, click it once to start
          if (await addBtn.isVisible().catch(() => false)) {
            await addBtn.click();
            log(`Clicked ADD for product ${productId} (1/${quantity}).`);
            itemsToAdd--;
            await p.waitForTimeout(500);
          }

          // Use increment button for remaining quantity
          if (itemsToAdd > 0) {
            await p.waitForTimeout(1000);

            // Find the + button
            const plusBtn = card.locator(".icon-plus").first();
            let plusClickable;
            if (await plusBtn.count() > 0) {
              plusClickable = plusBtn.locator("..");
            } else {
              plusClickable = card.locator("text='+'").first();
            }

            if (await plusClickable.isVisible().catch(() => false)) {
              for (let i = 0; i < itemsToAdd; i++) {
                await plusClickable.click();
                log(`Incrementing quantity for ${productId} (${quantity - itemsToAdd + i + 1}/${quantity}).`);

                // Check for quantity limit
                try {
                  const limitMsg = p.getByText("Sorry, you can't add more of this item");
                  if (await limitMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
                    log(`Quantity limit reached for ${productId}.`);
                    respond({
                      id,
                      success: true,
                      data: { added: true, quantity: quantity - itemsToAdd + i + 1, limit_reached: true },
                    });
                    break;
                  }
                } catch {
                  // No limit message, continue
                }

                await p.waitForTimeout(500);
              }
            } else {
              log(`Could not find '+' button for remaining quantity of ${productId}.`);
            }
          }

          await p.waitForTimeout(1000);

          // Check for store unavailable modal after adding
          if (await p.isVisible("text=\"Sorry, can't take your order\"").catch(() => false)) {
            respond({ id, success: false, error: "WARNING: Store is unavailable (modal detected after add)." });
            break;
          }

          respond({ id, success: true, data: { added: true, quantity } });
        } catch (e) {
          respond({ id, success: false, error: `Failed to add to cart: ${e}` });
        }
        break;
      }

      case "getCart": {
        const p = await ensurePage();

        // Click the cart button to open the cart drawer
        const cartBtn = p.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
        if (await cartBtn.count() > 0) {
          await cartBtn.first().click();
          await p.waitForTimeout(2000);
        } else {
          respond({ id, success: true, data: { items: [], subtotal: 0, delivery_fee: 0, total: 0, warning: "Cart button not found." } });
          break;
        }

        // 1. Critical availability check
        const storeStatus = await isStoreClosed(p);
        if (storeStatus) {
          respond({ id, success: true, data: { items: [], subtotal: 0, delivery_fee: 0, total: 0, warning: `CRITICAL: ${storeStatus}` } });
          break;
        }

        // 2. Check for cart activity indicators
        const isCartActive =
          await p.isVisible("text=/Bill details/i").catch(() => false) ||
          await p.isVisible("button:has-text('Proceed')").catch(() => false) ||
          await p.isVisible("text='ordering for'").catch(() => false);

        // Scrape cart content from the drawer
        const drawer = p.locator(
          "div[class*='CartDrawer'], div[class*='CartSidebar'], div.cart-modal-rn, div[class*='CartWrapper__CartContainer']"
        ).first();

        let cartText = "";
        if (await drawer.count() > 0) {
          cartText = await drawer.innerText().catch(() => "");
          if (cartText.includes("Currently unavailable") || cartText.includes("can't take your order")) {
            respond({ id, success: true, data: { items: [], subtotal: 0, delivery_fee: 0, total: 0, warning: "CRITICAL: Store is unavailable (detected in cart)." } });
            break;
          }
        }

        if (!isCartActive && !cartText.includes("₹")) {
          respond({ id, success: true, data: { items: [], subtotal: 0, delivery_fee: 0, total: 0, warning: "Cart seems empty or store is unavailable." } });
          break;
        }

        // Parse total from cart text
        let total = 0;
        const totalMatch = cartText.match(/(?:Grand Total|Total|To Pay)[^\d₹]*[₹]?\s*([\d,.]+)/i);
        if (totalMatch) {
          total = extractPrice(totalMatch[1]);
        }

        respond({
          id,
          success: true,
          data: {
            items: [],
            subtotal: total,
            delivery_fee: 0,
            total,
            raw_cart_text: cartText,
          },
        });
        break;
      }

      case "updateCartItem": {
        const p = await ensurePage();
        const productId = params.productId as string;
        const quantity = (params.quantity as number) || 0;

        const card = p.locator(`div[id='${productId}']`);

        if (await card.count() === 0) {
          respond({ id, success: false, error: `Product ${productId} not found on page` });
          break;
        }

        if (quantity === 0) {
          // Remove: click minus until ADD reappears
          try {
            while (true) {
              const minusBtn = card.locator(".icon-minus").first();
              if (await minusBtn.count() === 0) break;
              await minusBtn.locator("..").click();
              await p.waitForTimeout(500);
              if (await card.locator("div").filter({ hasText: "ADD" }).last().isVisible().catch(() => false)) {
                break;
              }
            }
            respond({ id, success: true, data: { updated: true } });
          } catch {
            respond({ id, success: false, error: "Failed to update cart item" });
          }
        } else {
          respond({ id, success: true, data: { updated: true } });
        }
        break;
      }

      case "removeFromCart": {
        const p = await ensurePage();
        const productId = params.productId as string;
        const quantity = (params.quantity as number) || 1;

        let card = p.locator(`div[id='${productId}']`);

        if (await card.count() === 0) {
          // Attempt recovery via known products re-search
          const known = knownProducts.get(productId);
          if (known?.sourceQuery) {
            await reSearchProduct(p, known.sourceQuery);
            card = p.locator(`div[id='${productId}']`);
            if (await card.count() === 0) {
              respond({ id, success: false, error: `Product ${productId} not found after recovery search.` });
              break;
            }
          } else {
            respond({ id, success: false, error: `Product ${productId} not found and unknown.` });
            break;
          }
        }

        // Find the minus button
        let minusBtn = card.locator(".icon-minus").first();
        let minusClickable;
        if (await minusBtn.count() > 0) {
          minusClickable = minusBtn.locator("..");
        } else {
          minusClickable = card.locator("text='-'").first();
        }

        if (await minusClickable.isVisible().catch(() => false)) {
          try {
            for (let i = 0; i < quantity; i++) {
              await minusClickable.click();
              log(`Decrementing quantity for ${productId} (${i + 1}/${quantity}).`);
              await p.waitForTimeout(500);

              // If ADD button reappears, item is fully removed
              if (await card.locator("div").filter({ hasText: "ADD" }).last().isVisible().catch(() => false)) {
                log(`Item ${productId} completely removed from cart.`);
                break;
              }
            }
            respond({ id, success: true, data: { removed: true } });
          } catch {
            respond({ id, success: false, error: "Failed to remove item" });
          }
        } else {
          respond({ id, success: false, error: `Item ${productId} is not in cart (no '-' button found).` });
        }
        break;
      }

      case "clearCart": {
        const p = await ensurePage();

        const cartBtn = p.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
        if (await cartBtn.count() > 0) {
          await cartBtn.first().click();
          await p.waitForTimeout(2000);
        }

        let removed = 0;
        while (true) {
          const minusBtns = p.locator(".icon-minus");
          const btnCount = await minusBtns.count();
          if (btnCount === 0) break;
          await minusBtns.first().locator("..").click();
          await p.waitForTimeout(500);
          removed++;
          if (removed > 100) break; // Safety limit
        }

        respond({ id, success: true, data: { items_removed: removed } });
        break;
      }

      case "setLocation": {
        const p = await ensurePage();
        const locationName = params.addressQuery as string;

        if (!locationName) {
          respond({ id, success: false, error: "No location name provided" });
          break;
        }

        await debugStep(p, `Setting location to: ${locationName}`);

        try {
          // Check if location input modal is already open
          if (!await p.isVisible("input[name='select-locality']").catch(() => false)) {
            // Click location bar to open modal
            if (await p.isVisible("div[class*='LocationBar__Container']")) {
              await p.click("div[class*='LocationBar__Container']");
            }

            // Wait for location input
            await p.waitForSelector(
              "input[name='select-locality'], input[placeholder*='search delivery location']",
              { state: "visible", timeout: 30000 }
            );
          }

          const locInput = p.locator("input[name='select-locality'], input[placeholder*='search delivery location']").first();
          await locInput.fill(locationName);
          await p.waitForTimeout(1000);

          // Select first result
          const firstResult = p.locator("div[class*='LocationSearchBox__LocationItemContainer']").first();
          if (await firstResult.isVisible().catch(() => false)) {
            await firstResult.click();
            log("Selected first location result.");
          } else {
            log("No location results found.");
          }

          // Wait for location update
          await p.waitForTimeout(2000);

          // Check if new location is unavailable
          if (await p.isVisible("text='Currently unavailable'").catch(() => false)) {
            respond({
              id,
              success: true,
              data: { location_set: true, warning: "Store is marked as 'Currently unavailable' at this location." },
            });
          } else {
            respond({ id, success: true, data: { location_set: true } });
          }
        } catch (e) {
          respond({ id, success: false, error: `Error setting location: ${e}` });
        }
        break;
      }

      case "getAddresses": {
        const p = await ensurePage();

        // Check store status
        const storeStatus = await isStoreClosed(p);
        if (storeStatus) {
          respond({ id, success: false, error: `CRITICAL: ${storeStatus}` });
          break;
        }

        // Check if address selection modal is visible
        if (!await p.isVisible("text='Select delivery address'").catch(() => false)) {
          log("Address selection modal not visible.");
          respond({ id, success: true, data: { addresses: [], hint: "Address modal not open. Try checkout first, or click the location bar." } });
          break;
        }

        log("Address modal detected. Parsing addresses...");
        const addresses: Array<Record<string, unknown>> = [];
        const items = p.locator("div[class*='AddressList__AddressItemWrapper']");
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

        respond({ id, success: true, data: { addresses } });
        break;
      }

      case "selectAddress": {
        const p = await ensurePage();
        const index = (params.index as number) || 0;

        const storeStatus = await isStoreClosed(p);
        if (storeStatus) {
          respond({ id, success: false, error: `CRITICAL: ${storeStatus}` });
          break;
        }

        const items = p.locator("div[class*='AddressList__AddressItemWrapper']");
        if (index < await items.count()) {
          await items.nth(index).click();
          await p.waitForTimeout(2000);
          respond({ id, success: true, data: { selected: true } });
        } else {
          respond({ id, success: false, error: `Invalid address index: ${index}` });
        }
        break;
      }

      case "checkout": {
        const p = await ensurePage();

        const storeStatus = await isStoreClosed(p);
        if (storeStatus) {
          respond({ id, success: false, error: `CRITICAL: ${storeStatus}` });
          break;
        }

        try {
          const proceedBtn = p.locator("button, div").filter({ hasText: "Proceed" }).last();

          // If Proceed not visible, try opening the cart first
          if (!await proceedBtn.isVisible().catch(() => false)) {
            log("Proceed button not visible. Attempting to open Cart drawer...");
            const cartBtn = p.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
            if (await cartBtn.count() > 0) {
              await cartBtn.first().click();
              log("Clicked 'My Cart' button.");
              await p.waitForTimeout(2000);
            } else {
              log("Could not find 'My Cart' button.");
            }
          }

          // Try clicking Proceed
          if (await proceedBtn.isVisible().catch(() => false)) {
            await proceedBtn.click();
            log("Cart checkout initiated. Address selection or payment should follow.");
            await p.waitForTimeout(3000);
            respond({
              id,
              success: true,
              data: { message: "Checkout initiated. Select address or proceed to payment." },
            });
          } else {
            respond({ id, success: false, error: "Proceed button not visible. Cart might be empty or store unavailable." });
          }
        } catch (e) {
          respond({ id, success: false, error: `Checkout failed: ${e}` });
        }
        break;
      }

      case "getUpiIds": {
        const p = await ensurePage();
        log("Getting available UPI IDs...");

        try {
          const iframeElement = await p.waitForSelector("#payment_widget", { timeout: 30000 });
          if (!iframeElement) {
            respond({ id, success: true, data: { upi_ids: [] } });
            break;
          }

          const frame = await iframeElement.contentFrame();
          if (!frame) {
            respond({ id, success: true, data: { upi_ids: [] } });
            break;
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
          respond({ id, success: true, data: { upi_ids: ids } });
        } catch (e) {
          respond({ id, success: false, error: `Error getting UPI IDs: ${e}` });
        }
        break;
      }

      case "selectUpiId": {
        const p = await ensurePage();
        const upiId = params.upiId as string;
        log(`Selecting UPI ID: ${upiId}`);

        try {
          const iframeElement = await p.waitForSelector("#payment_widget", { timeout: 30000 });
          if (!iframeElement) {
            respond({ id, success: false, error: "Payment widget iframe not found" });
            break;
          }

          const frame = await iframeElement.contentFrame();
          if (!frame) {
            respond({ id, success: false, error: "Could not access payment iframe" });
            break;
          }

          // 1. Try clicking on a saved VPA
          const savedVpa = frame.locator(`text='${upiId}'`);
          if (await savedVpa.count() > 0) {
            await savedVpa.first().click();
            log(`Clicked saved VPA: ${upiId}`);
            respond({ id, success: true, data: { selected: true } });
            break;
          }

          // 2. Expand UPI section if needed
          const upiHeader = frame.locator("div").filter({ hasText: "UPI" }).last();
          if (await upiHeader.count() > 0) {
            await upiHeader.click();
          }
          await p.waitForTimeout(500);

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

          respond({ id, success: true, data: { selected: true } });
        } catch (e) {
          respond({ id, success: false, error: `Error selecting UPI ID: ${e}` });
        }
        break;
      }

      case "payNow": {
        const p = await ensurePage();
        log("Clicking Pay Now...");

        try {
          // Strategy 1: Specific class match
          const payBtnSpecific = p.locator("div[class*='Zpayments__Button']:has-text('Pay Now')");
          if (await payBtnSpecific.count() > 0 && await payBtnSpecific.first().isVisible().catch(() => false)) {
            await payBtnSpecific.first().click();
            log("Clicked 'Pay Now'. Please approve the payment on your UPI app.");
            respond({ id, success: true, data: { message: "Pay Now clicked. Approve payment on your UPI app." } });
            break;
          }

          // Strategy 2: Text match on page
          const payBtnText = p.locator("div, button").filter({ hasText: "Pay Now" }).last();
          if (await payBtnText.count() > 0 && await payBtnText.isVisible().catch(() => false)) {
            await payBtnText.click();
            log("Clicked 'Pay Now'. Please approve the payment on your UPI app.");
            respond({ id, success: true, data: { message: "Pay Now clicked. Approve payment on your UPI app." } });
            break;
          }

          // Strategy 3: Check inside iframe
          const iframeElement = await p.querySelector("#payment_widget");
          if (iframeElement) {
            const frame = await iframeElement.contentFrame();
            if (frame) {
              const frameBtn = frame.locator("text='Pay Now'");
              if (await frameBtn.count() > 0) {
                await frameBtn.first().click();
                log("Clicked 'Pay Now' inside iframe.");
                respond({ id, success: true, data: { message: "Pay Now clicked inside iframe. Approve payment on your UPI app." } });
                break;
              }
            }
          }

          respond({ id, success: false, error: "Could not find 'Pay Now' button." });
        } catch (e) {
          respond({ id, success: false, error: `Error clicking Pay Now: ${e}` });
        }
        break;
      }

      case "getOrders": {
        const p = await ensurePage();
        const limit = (params.limit as number) || 5;

        await p.goto("https://blinkit.com/orders", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await p.waitForTimeout(3000);

        const orders: Array<Record<string, unknown>> = [];
        const orderCards = p.locator("div[class*='OrderCard'], div[class*='order-card']");
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

        respond({ id, success: true, data: { orders } });
        break;
      }

      case "trackOrder": {
        const p = await ensurePage();
        const orderId = params.orderId as string | undefined;

        const url = orderId
          ? `https://blinkit.com/order/${orderId}`
          : "https://blinkit.com/orders";

        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await p.waitForTimeout(3000);

        if (!orderId) {
          try {
            await p.locator("div[class*='OrderCard'], div[class*='order-card']").first().click();
            await p.waitForTimeout(2000);
          } catch {
            respond({ id, success: false, error: "No orders found" });
            break;
          }
        }

        const pageText = await p.locator("body").innerText().catch(() => "");

        respond({
          id,
          success: true,
          data: {
            order_id: orderId ?? "latest",
            status: "See tracking details below",
            page_text: pageText.substring(0, 2000),
          },
        });
        break;
      }

      case "close": {
        log("Closing browser");
        // Save session before closing
        await saveStorageState();
        if (browser) {
          await browser.close();
          browser = null;
          context = null;
          page = null;
        }
        respond({ id, success: true });
        break;
      }

      default:
        respond({ id, success: false, error: `Unknown action: ${action}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Error handling '${action}': ${message}`);
    respond({ id, success: false, error: message });
  }
}

// Main: read JSON commands from stdin
const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const command = JSON.parse(line) as BridgeCommand;
    handleCommand(command).catch((e) => {
      log(`Unhandled error in command '${command.action}': ${e}`);
      respond({ id: command.id, success: false, error: String(e) });
    });
  } catch (e) {
    log(`Failed to parse command: ${e}`);
  }
});

rl.on("close", () => {
  log("stdin closed, shutting down");
  if (context) {
    saveStorageState().finally(() => {
      if (browser) browser.close();
      process.exit(0);
    });
  } else {
    if (browser) browser.close();
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down");
  if (context) {
    saveStorageState().finally(() => {
      if (browser) browser.close();
      process.exit(0);
    });
  } else {
    if (browser) browser.close();
    process.exit(0);
  }
});

log("Playwright bridge started, waiting for commands...");
