import type { Page } from "playwright";
import { debugStep, extractPrice } from "./helpers.js";
import { SELECTORS } from "./selectors.js";
import type { Product } from "../types.js";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

// Known products tracking for cross-search cart recovery
const knownProducts = new Map<string, { sourceQuery: string; name: string }>();
let currentQuery = "";

/** Get the known products map (used by cart-flow for re-search recovery) */
export function getKnownProducts(): Map<string, { sourceQuery: string; name: string }> {
  return knownProducts;
}

/** Get the current search query */
export function getCurrentQuery(): string {
  return currentQuery;
}

/** Re-search for a product using known query (for cart recovery) */
export async function reSearchProduct(page: Page, sourceQuery: string): Promise<void> {
  log(`Re-searching for products from query: "${sourceQuery}"`);

  // Activate search
  if (await page.isVisible(SELECTORS.SEARCH_LINK)) {
    await page.click(SELECTORS.SEARCH_LINK);
  } else if (await page.isVisible(SELECTORS.SEARCH_PLACEHOLDER)) {
    await page.click(SELECTORS.SEARCH_PLACEHOLDER);
  } else if (await page.isVisible(SELECTORS.SEARCH_INPUT_PLACEHOLDER)) {
    await page.click(SELECTORS.SEARCH_INPUT_PLACEHOLDER);
  } else {
    try {
      await page.click(SELECTORS.SEARCH_TEXT, { timeout: 3000 });
    } catch {
      await page.goto(`https://blinkit.com/s/?q=${encodeURIComponent(sourceQuery)}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(2000);
      return;
    }
  }

  try {
    const searchInput = await page.waitForSelector(
      SELECTORS.SEARCH_INPUT,
      { state: "visible", timeout: 15000 }
    );
    if (searchInput) {
      await searchInput.fill(sourceQuery);
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
    }
  } catch {
    log("Search input not found during re-search");
  }

  // Wait for results
  try {
    await page.waitForSelector(SELECTORS.PRODUCT_CARD_ADD, { timeout: 30000 });
  } catch {
    log("No product cards found during re-search");
  }
  await page.waitForTimeout(1000);
}

// ── Helper: batch-parse product cards from DOM in a single evaluate call ──
async function batchParseCards(page: Page, lim: number): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((lim: number) => {
    const doc = (globalThis as any).document;
    const cards = doc.querySelectorAll("div[role='button']");
    const results: any[] = [];
    for (const card of cards) {
      const text = card.textContent || "";
      if (!text.includes("ADD") || !text.includes("\u20B9")) continue;
      if (results.length >= lim) break;

      const id = card.id || `unknown-${results.length}`;
      const nameEl = card.querySelector("div[class*='line-clamp-2']") ??
                     card.querySelector("div[class*='line-clamp']");
      const name = nameEl?.textContent?.trim() ||
                   text.split("\n").find((l: string) => l.trim()) || "Unknown Product";

      let price = 0;
      let priceDisplay = "Unknown Price";
      // Find the first ₹ symbol and extract the price right after it
      const priceMatch = text.match(/₹\s*([\d,]+(?:\.\d+)?)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(/,/g, "")) || 0;
        // Capture surrounding context for display
        const matchIdx = text.indexOf(priceMatch[0]);
        priceDisplay = text.substring(Math.max(0, matchIdx - 5), matchIdx + priceMatch[0].length + 5).trim();
      }

      const weightEl = card.querySelector("div[class*='plp-product__quantity'], div[class*='Weight']");
      const unit = weightEl?.textContent?.trim() || "";
      const img = card.querySelector("img");
      const imgSrc = img?.getAttribute("src") || "";

      results.push({
        index: results.length, id, name, price, price_display: priceDisplay,
        mrp: price, unit, in_stock: true, image_url: imgSrc,
      });
    }
    return results;
  }, lim);
}

// ── Helper: parse products from the Blinkit layout/search API response ──
// Response shape: { response: { snippets: [ { widget_type, data: { ... } } ] } }
// Product snippets have widget_type "product_card_snippet_type_2".
// Best structured data is in data.atc_action.add_to_cart.cart_item.
function parseApiProducts(apiData: any, lim: number): Array<Record<string, unknown>> {
  // Navigate to response.snippets (the API wraps it)
  const snippets: any[] = apiData?.response?.snippets ?? apiData?.snippets ?? [];
  if (snippets.length === 0) return [];

  const results: Array<Record<string, unknown>> = [];
  let idx = 0;
  for (const snippet of snippets) {
    if (results.length >= lim) break;
    if (snippet.widget_type !== "product_card_snippet_type_2") continue;

    const d = snippet.data;
    if (!d) continue;

    // Prefer the structured cart_item data (has numeric price, unit, etc.)
    const cartItem = d.atc_action?.add_to_cart?.cart_item;
    if (cartItem) {
      const productId = String(cartItem.product_id);
      const name = cartItem.product_name ?? cartItem.display_name ?? "Unknown Product";
      const price = cartItem.price ?? 0;
      const mrp = cartItem.mrp ?? price;
      const unit = cartItem.unit ?? "";
      const inventory = cartItem.inventory ?? 0;
      const imageUrl = cartItem.image_url ?? d.image?.url ?? "";
      const brand = cartItem.brand ?? d.brand_name?.text ?? "";

      knownProducts.set(productId, { sourceQuery: currentQuery, name });

      results.push({
        index: idx++,
        id: productId,
        name,
        price,
        price_display: d.normal_price?.text ?? `\u20B9${price}`,
        mrp,
        unit,
        in_stock: inventory > 0 && d.product_state !== "out_of_stock",
        image_url: imageUrl,
        brand,
        inventory,
      });
    } else {
      // Fallback: extract from snippet.data directly
      const productId = d.product_id ?? d.identity?.id ?? d.meta?.product_id ?? `unknown-${idx}`;
      const name = d.name?.text ?? d.display_name?.text ?? "Unknown Product";
      const priceText = d.normal_price?.text ?? "";
      const price = parseFloat(priceText.replace(/[^0-9.]/g, "")) || 0;
      const mrpText = d.mrp?.text ?? priceText;
      const mrp = parseFloat(mrpText.replace(/[^0-9.]/g, "")) || price;

      if (String(productId) !== `unknown-${idx}`) {
        knownProducts.set(String(productId), { sourceQuery: currentQuery, name });
      }

      results.push({
        index: idx++,
        id: String(productId),
        name,
        price,
        price_display: priceText || `\u20B9${price}`,
        mrp,
        unit: d.variant?.text ?? "",
        in_stock: (d.inventory ?? 0) > 0 && d.product_state !== "out_of_stock",
        image_url: d.image?.url ?? "",
        brand: d.brand_name?.text ?? "",
        inventory: d.inventory ?? 0,
      });
    }
  }
  return results;
}

// ── Helper: check for "no results" state on page ──
async function checkNoResults(page: Page): Promise<boolean> {
  return (await page.isVisible(SELECTORS.NO_RESULTS_FOUND).catch(() => false)) ||
         (await page.isVisible(SELECTORS.NO_RESULTS_REGEX).catch(() => false));
}

// ── Helper: update known products map from DOM-parsed results ──
function updateKnownProducts(parsed: Array<Record<string, unknown>>): void {
  for (const prod of parsed) {
    if (prod.id && !(prod.id as string).startsWith("unknown-")) {
      knownProducts.set(prod.id as string, { sourceQuery: currentQuery, name: prod.name as string });
    }
  }
}

/**
 * Search for products on Blinkit.
 * Strategy 1: Direct URL navigation + API response interception (fastest).
 * Strategy 2: UI search bar flow (fallback).
 * Returns an array of product records.
 */
export async function searchProducts(
  page: Page,
  query: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  currentQuery = query;
  let products: Array<Record<string, unknown>> = [];

  await debugStep(page, `Searching for: "${query}"`);

  // ═══════════════════════════════════════════════════════════════════
  // STRATEGY 1: Direct URL navigation + API response interception
  //   Fastest path -- navigates to search URL and captures the XHR
  //   response with structured JSON, avoiding all DOM parsing.
  // ═══════════════════════════════════════════════════════════════════
  try {
    log("Strategy 1: Direct URL + API interception");
    await debugStep(page, "Navigating directly to search URL");

    // Listen for the search API response BEFORE navigating
    // Actual endpoint: POST blinkit.com/v1/layout/search?q=...&search_type=type_to_search
    const apiResponsePromise = page.waitForResponse(
      (resp) => {
        const url = resp.url();
        return url.includes("/v1/layout/search") && url.includes("q=") && resp.status() === 200;
      },
      { timeout: 15000 }
    ).catch(() => null);

    await page.goto(`https://blinkit.com/s/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Try parsing the intercepted API response
    const apiResponse = await apiResponsePromise;
    if (apiResponse) {
      try {
        const apiData = await apiResponse.json();
        products = parseApiProducts(apiData, limit);
        if (products.length > 0) {
          log(`Strategy 1 success: ${products.length} products from API interception`);
        }
      } catch (e) {
        log(`API response parse failed: ${e}`);
      }
    }

    // API interception didn't yield results -- try batch DOM parse on the same page
    if (products.length === 0) {
      log("API interception missed, trying batch DOM parse on direct URL page");
      try {
        await page.waitForSelector(SELECTORS.PRODUCT_CARD_ADD, { timeout: 10000 });
        products = await batchParseCards(page, limit);
        updateKnownProducts(products);
        if (products.length > 0) {
          log(`Strategy 1 (DOM fallback) success: ${products.length} products`);
        }
      } catch {
        if (await checkNoResults(page)) {
          log("No results found for this query.");
          return [];
        }
        log("No product cards found on direct URL page.");
      }
    }
  } catch (e) {
    log(`Strategy 1 failed: ${e}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STRATEGY 2 (fallback): UI search bar flow
  //   Activates the search bar via clicks, types query, presses Enter.
  //   Uses batch DOM parse to extract results.
  // ═══════════════════════════════════════════════════════════════════
  if (products.length === 0) {
    log("Strategy 2: UI search bar flow (fallback)");
    try {
      // Navigate to homepage if not already there
      if (!page.url().includes("blinkit.com")) {
        await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2000);
      }

      // Activate search bar
      await debugStep(page, "Activating search bar (fallback)");
      if (await page.isVisible(SELECTORS.SEARCH_LINK)) {
        await page.click(SELECTORS.SEARCH_LINK);
      } else if (await page.isVisible(SELECTORS.SEARCH_PLACEHOLDER)) {
        await page.click(SELECTORS.SEARCH_PLACEHOLDER);
      } else if (await page.isVisible(SELECTORS.SEARCH_INPUT_PLACEHOLDER)) {
        await page.click(SELECTORS.SEARCH_INPUT_PLACEHOLDER);
      } else {
        await page.click(SELECTORS.SEARCH_TEXT, { timeout: 3000 });
      }

      // Type and submit
      const searchInput = await page.waitForSelector(
        SELECTORS.SEARCH_INPUT,
        { state: "visible", timeout: 30000 }
      );
      if (searchInput) {
        await searchInput.fill(query);
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
      }

      // Wait for results
      try {
        await page.waitForSelector(SELECTORS.PRODUCT_CARD_ADD, { timeout: 30000 });
      } catch {
        if (await checkNoResults(page)) {
          log("No results found (fallback).");
          return [];
        }
        log("Could not detect product cards (fallback).");
      }

      // Batch DOM parse
      products = await batchParseCards(page, limit);
      updateKnownProducts(products);
      if (products.length > 0) {
        log(`Strategy 2 success: ${products.length} products from UI flow`);
      }
    } catch (e) {
      log(`Strategy 2 failed: ${e}`);
    }
  }

  log(`Search complete: ${products.length} products found.`);
  return products;
}

/**
 * Get detailed product information by navigating to its page.
 */
export async function getProductDetails(page: Page, productId: string): Promise<Record<string, unknown>> {
  await page.goto(`https://blinkit.com/prn/product/prid/${productId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  const name = await page.locator(SELECTORS.PRODUCT_DETAIL_NAME).first().textContent().catch(() => null);
  const priceText = await page.locator(SELECTORS.PRODUCT_DETAIL_PRICE).first().textContent().catch(() => null);
  const description = await page.locator(SELECTORS.PRODUCT_DETAIL_DESCRIPTION).first().textContent().catch(() => null);
  const brand = await page.locator(SELECTORS.PRODUCT_DETAIL_BRAND).first().textContent().catch(() => null);

  const images: string[] = [];
  const imgs = page.locator(SELECTORS.PRODUCT_IMAGE);
  const imgCount = await imgs.count();
  for (let j = 0; j < imgCount; j++) {
    const src = await imgs.nth(j).getAttribute("src").catch(() => null);
    if (src) images.push(src);
  }

  return {
    id: productId,
    name: name?.trim() ?? "Unknown",
    price: extractPrice(priceText),
    mrp: extractPrice(priceText),
    description: description?.trim() ?? null,
    brand: brand?.trim() ?? null,
    images,
    in_stock: true,
  };
}

/**
 * Browse all categories from the Blinkit homepage.
 */
export async function browseCategories(page: Page): Promise<Array<{ id: string; name: string; icon_url?: string }>> {
  await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  const categories: Array<{ id: string; name: string; icon_url?: string }> = [];
  const categoryLinks = page.locator(SELECTORS.CATEGORY_LINK);
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

  return categories;
}

/**
 * Browse products in a specific category.
 */
export async function browseCategoryProducts(
  page: Page,
  categoryId: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  await page.goto(`https://blinkit.com/cn/${categoryId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2000);

  try {
    await page.waitForSelector(SELECTORS.PRODUCT_CARD_ADD, { timeout: 15000 });
  } catch {
    // No products found
  }

  const products: Array<Record<string, unknown>> = [];
  const cards = page.locator(SELECTORS.PRODUCT_CARD_ADD).filter({ hasText: "\u20B9" });
  const cardCount = Math.min(await cards.count(), limit);

  for (let i = 0; i < cardCount; i++) {
    try {
      const card = cards.nth(i);
      const textContent = await card.innerText();
      const productId = await card.getAttribute("id") ?? `product-${i}`;

      const nameLocator = card.locator(SELECTORS.CATEGORY_PRODUCT_NAME);
      let name = "Unknown";
      if (await nameLocator.count() > 0) {
        name = (await nameLocator.first().innerText()).trim();
      } else {
        const lines = textContent.split("\n").filter((l: string) => l.trim());
        name = lines[0] ?? "Unknown";
      }

      let price = 0;
      for (const part of textContent.split("\n")) {
        if (part.includes("\u20B9")) {
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

  return products;
}
