import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import { extractNumber, extractProductId } from "./helpers.ts";
import { BLINKIT_BASE_URL } from "../constants.ts";
import type { Product } from "../types.ts";

export async function searchProducts(page: Page, query: string, limit: number): Promise<Product[]> {
  // Navigate to search
  await page.goto(`${BLINKIT_BASE_URL}/s/?q=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // Scrape product cards
  const products: Product[] = [];
  const cards = page.locator(SELECTORS.PRODUCT_CARD);
  const count = Math.min(await cards.count(), limit);

  for (let i = 0; i < count; i++) {
    try {
      const card = cards.nth(i);
      const name = await card.locator(SELECTORS.PRODUCT_NAME).textContent().catch(() => null);
      const priceText = await card.locator(SELECTORS.PRODUCT_PRICE).textContent().catch(() => null);
      const weight = await card.locator(SELECTORS.PRODUCT_WEIGHT).textContent().catch(() => null);
      const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);
      const href = await card.locator("a").first().getAttribute("href").catch(() => null);

      const id = extractProductId(href) ?? `product-${i}`;
      const price = extractNumber(priceText);

      products.push({
        id,
        name: name?.trim() ?? "Unknown",
        price,
        mrp: price,
        unit: weight?.trim() ?? "",
        in_stock: true,
        image_url: imgSrc ?? "",
      });
    } catch {
      // Skip individual card errors
    }
  }

  return products;
}

export async function getProductDetails(page: Page, productId: string): Promise<Record<string, unknown> | null> {
  await page.goto(`${BLINKIT_BASE_URL}/prn/product/prid/${productId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // Scrape product details page
  const name = await page.locator("h1, [class*='ProductName']").first().textContent().catch(() => null);
  if (!name) return null;

  const priceText = await page.locator("[class*='Price'], [class*='price']").first().textContent().catch(() => null);
  const description = await page.locator("[class*='Description'], [class*='description']").first().textContent().catch(() => null);
  const brand = await page.locator("[class*='Brand'], [class*='brand']").first().textContent().catch(() => null);
  const images: string[] = [];
  const imgs = page.locator("img[class*='product'], img[class*='Product']");
  const imgCount = await imgs.count();
  for (let i = 0; i < imgCount; i++) {
    const src = await imgs.nth(i).getAttribute("src").catch(() => null);
    if (src) images.push(src);
  }

  return {
    id: productId,
    name: name.trim(),
    price: extractNumber(priceText),
    mrp: extractNumber(priceText),
    description: description?.trim() ?? null,
    brand: brand?.trim() ?? null,
    images,
    in_stock: true,
  };
}

export async function browseCategories(page: Page): Promise<Array<{ id: string; name: string; icon_url?: string }>> {
  await page.goto(BLINKIT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const categories: Array<{ id: string; name: string; icon_url?: string }> = [];
  const categoryLinks = page.locator("a[href*='/cn/']");
  const count = await categoryLinks.count();

  for (let i = 0; i < count; i++) {
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

export async function browseCategoryProducts(
  page: Page,
  categoryId: string,
  limit: number
): Promise<Product[]> {
  await page.goto(`${BLINKIT_BASE_URL}/cn/${categoryId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // Reuse the same product card scraping logic
  const products: Product[] = [];
  const cards = page.locator(SELECTORS.PRODUCT_CARD);
  const count = Math.min(await cards.count(), limit);

  for (let i = 0; i < count; i++) {
    try {
      const card = cards.nth(i);
      const name = await card.locator(SELECTORS.PRODUCT_NAME).textContent().catch(() => null);
      const priceText = await card.locator(SELECTORS.PRODUCT_PRICE).textContent().catch(() => null);
      const weight = await card.locator(SELECTORS.PRODUCT_WEIGHT).textContent().catch(() => null);
      const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);
      const href = await card.locator("a").first().getAttribute("href").catch(() => null);

      const id = extractProductId(href) ?? `product-${i}`;
      const price = extractNumber(priceText);

      products.push({
        id,
        name: name?.trim() ?? "Unknown",
        price,
        mrp: price,
        unit: weight?.trim() ?? "",
        in_stock: true,
        image_url: imgSrc ?? "",
      });
    } catch {
      // Skip
    }
  }

  return products;
}
