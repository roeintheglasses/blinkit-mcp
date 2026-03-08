import type { Page } from "playwright";
import { log } from "./log.ts";
import { SELECTORS } from "./selectors.ts";
import type { OrderDetails } from "../types.ts";

/**
 * Helper: batch-parse order cards from DOM in a single evaluate call.
 * Extracts comprehensive order information including detailed item data.
 */
async function batchParseOrderCards(page: Page, lim: number): Promise<OrderDetails[]> {
  return page.evaluate((lim: number) => {
    const doc = (globalThis as any).document;
    const cards = doc.querySelectorAll("div[class*='OrderCard'], div[class*='order-card']");
    const results: any[] = [];

    for (let i = 0; i < cards.length && i < lim; i++) {
      const card = cards[i];
      const cardText = card.textContent || "";

      // Extract order ID from data attributes or URL
      let orderId = card.getAttribute("data-order-id") ||
                    card.getAttribute("id") ||
                    card.querySelector("a[href*='/order/']")?.getAttribute("href")?.match(/\/order\/([^/?]+)/)?.[1] ||
                    `order-${i}`;

      // Extract date
      const dateEl = card.querySelector("div[class*='OrderDate'], span[class*='order-date'], div[class*='Date']");
      const date = dateEl?.textContent?.trim() || "";

      // Extract total
      let total = 0;
      const totalEl = card.querySelector("div[class*='OrderTotal'], span[class*='order-total'], div[class*='Total']");
      if (totalEl) {
        const totalText = totalEl.textContent || "";
        const match = totalText.match(/[₹]?\s*([\d,]+(?:\.\d+)?)/);
        if (match) {
          total = parseFloat(match[1].replace(/,/g, "")) || 0;
        }
      }

      // Extract status
      const statusEl = card.querySelector("div[class*='OrderStatus'], span[class*='order-status'], div[class*='Status']");
      const status = statusEl?.textContent?.trim() || "Unknown";

      // Extract items from the order card
      const items: any[] = [];

      // Strategy 1: Look for item containers
      const itemContainers = card.querySelectorAll(
        "div[class*='OrderItem'], div[class*='order-item'], div[class*='ProductCard'], div[class*='CartProduct']"
      );

      if (itemContainers.length > 0) {
        for (const itemEl of itemContainers) {
          const itemText = itemEl.textContent || "";

          // Extract product ID from data attributes
          const productId = itemEl.getAttribute("data-product-id") ||
                           itemEl.getAttribute("data-id") ||
                           itemEl.querySelector("[data-product-id]")?.getAttribute("data-product-id") ||
                           undefined;

          // Extract name
          const nameEl = itemEl.querySelector(
            "div[class*='ProductTitle'], div[class*='product-name'], div[class*='Name'], div[class*='line-clamp']"
          );
          const name = nameEl?.textContent?.trim() || itemText.split("\n")[0]?.trim() || "Unknown Item";

          // Extract quantity
          let quantity = 1;
          const qtyMatch = itemText.match(/(\d+)\s*x\s*/i) ||
                          itemText.match(/qty:\s*(\d+)/i) ||
                          itemText.match(/quantity:\s*(\d+)/i);
          if (qtyMatch) {
            quantity = parseInt(qtyMatch[1], 10) || 1;
          }

          // Extract price
          let price = 0;
          const priceEl = itemEl.querySelector("div[class*='Price'], span[class*='price']");
          const priceText = priceEl?.textContent || itemText;
          const priceMatch = priceText.match(/[₹]?\s*([\d,]+(?:\.\d+)?)/);
          if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(/,/g, "")) || 0;
          }

          // Extract variant
          const variantEl = itemEl.querySelector("div[class*='Variant'], div[class*='variant'], div[class*='Weight']");
          const variant = variantEl?.textContent?.trim() || undefined;

          // Extract image
          const imgEl = itemEl.querySelector("img");
          const imageUrl = imgEl?.getAttribute("src") || undefined;

          if (name && name !== "Unknown Item") {
            items.push({
              product_id: productId,
              name,
              quantity,
              original_price: price,
              variant,
              image_url: imageUrl,
            });
          }
        }
      } else {
        // Strategy 2: Parse from card text (fallback when no item containers found)
        const lines = cardText.split("\n").filter((l: string) => l.trim());

        for (const line of lines) {
          // Skip lines that look like order metadata
          if (line.includes("Delivered") ||
              line.includes("Pending") ||
              line.includes("Cancelled") ||
              line.match(/^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) ||
              line.includes("Grand total") ||
              line.includes("items") ||
              line.length < 3) {
            continue;
          }

          // Look for quantity pattern
          const qtyMatch = line.match(/^(.+?)\s+(\d+)\s*x/i);
          if (qtyMatch) {
            const name = qtyMatch[1].trim();
            const quantity = parseInt(qtyMatch[2], 10) || 1;
            const priceMatch = line.match(/[₹]?\s*([\d,]+(?:\.\d+)?)/);
            const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) || 0 : 0;

            items.push({
              name,
              quantity,
              original_price: price,
            });
          } else if (line.includes("₹")) {
            const parts = line.split("₹");
            if (parts.length >= 2) {
              const name = parts[0].trim();
              const priceMatch = parts[1].match(/([\d,]+(?:\.\d+)?)/);
              const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, "")) || 0 : 0;

              if (name.length > 2 && !name.match(/total|tax|fee|delivery/i)) {
                items.push({
                  name,
                  quantity: 1,
                  original_price: price,
                });
              }
            }
          }
        }
      }

      // Extract item count
      let itemCount = items.length;
      const itemCountMatch = cardText.match(/(\d+)\s+items?/i);
      if (itemCountMatch) {
        itemCount = parseInt(itemCountMatch[1], 10) || items.length;
      }

      results.push({
        order_id: orderId,
        date,
        total,
        item_count: itemCount,
        status,
        items,
      });
    }

    return results;
  }, lim);
}

/**
 * Fetch recent orders from the orders page with detailed item information.
 * Returns comprehensive order data including items, prices, and quantities.
 */
export async function getOrders(page: Page, limit: number): Promise<OrderDetails[]> {
  log(`Fetching order history (limit: ${limit})...`);

  await page.goto("https://blinkit.com/orders", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector(SELECTORS.ORDER_CARD, { timeout: 10000 }).catch(() => null);

  // Use batch parsing to extract detailed order information
  const orders = await batchParseOrderCards(page, limit);

  log(`Extracted ${orders.length} orders with item details`);
  return orders;
}

/**
 * Get full details for a specific order by navigating to its page.
 * Extracts comprehensive item information including product IDs, variants, and images.
 */
export async function getOrderDetails(page: Page, orderId: string): Promise<OrderDetails> {
  log(`Fetching details for order ${orderId}...`);

  await page.goto(`https://blinkit.com/order/${orderId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Wait for page content to load
  await page.waitForTimeout(2000);

  // Extract order details from the page
  const orderDetails = await page.evaluate((oid: string) => {
    const doc = (globalThis as any).document;
    const bodyText = doc.body.textContent || "";

    // Extract order metadata
    let orderId = oid;

    // Extract date
    let date = "";
    const dateMatch = bodyText.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i) ||
                     bodyText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (dateMatch) {
      date = dateMatch[1];
    }

    // Extract total
    let total = 0;
    const totalEl = doc.querySelector("div[class*='Total'], div[class*='total'], div[class*='GrandTotal']");
    if (totalEl) {
      const totalText = totalEl.textContent || "";
      const match = totalText.match(/[₹]?\s*([\d,]+(?:\.\d+)?)/);
      if (match) {
        total = parseFloat(match[1].replace(/,/g, "")) || 0;
      }
    }
    if (total === 0) {
      const totalMatch = bodyText.match(/(?:Grand\s+total|Order\s+total|Total)[:\s]*[₹]?\s*([\d,]+(?:\.\d+)?)/i);
      if (totalMatch) {
        total = parseFloat(totalMatch[1].replace(/,/g, "")) || 0;
      }
    }

    // Extract status
    let status = "Unknown";
    const statusEl = doc.querySelector("div[class*='Status'], span[class*='status']");
    if (statusEl) {
      status = statusEl.textContent?.trim() || "Unknown";
    } else if (bodyText.includes("Delivered")) {
      status = "Delivered";
    } else if (bodyText.includes("Cancelled")) {
      status = "Cancelled";
    } else if (bodyText.includes("Pending")) {
      status = "Pending";
    }

    // Extract items from the order page
    const items: any[] = [];

    // Strategy 1: Look for item containers
    const itemContainers = doc.querySelectorAll(
      "div[class*='OrderItem'], div[class*='order-item'], div[class*='ProductCard'], div[class*='product-card'], " +
      "div[class*='CartProduct'], div[class*='cart-product'], div[class*='Item']"
    );

    if (itemContainers.length > 0) {
      for (const itemEl of itemContainers) {
        const itemText = itemEl.textContent || "";

        if (itemText.length < 5 || itemText.includes("Total") || itemText.includes("Delivery")) {
          continue;
        }

        const productId = itemEl.getAttribute("data-product-id") ||
                         itemEl.getAttribute("data-id") ||
                         itemEl.querySelector("[data-product-id]")?.getAttribute("data-product-id") ||
                         itemEl.querySelector("[data-id]")?.getAttribute("data-id") ||
                         undefined;

        const nameEl = itemEl.querySelector(
          "div[class*='ProductTitle'], div[class*='product-title'], div[class*='ProductName'], " +
          "div[class*='product-name'], div[class*='Name'], div[class*='name'], div[class*='line-clamp']"
        );
        let name = nameEl?.textContent?.trim() || "";

        if (!name) {
          const lines = itemText.split("\n").filter((l: string) => l.trim());
          name = lines[0]?.trim() || "Unknown Item";
        }

        let quantity = 1;
        const qtyMatch = itemText.match(/(\d+)\s*x\s*/i) ||
                        itemText.match(/qty[:\s]*(\d+)/i) ||
                        itemText.match(/quantity[:\s]*(\d+)/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1], 10) || 1;
        }

        let price = 0;
        const priceEl = itemEl.querySelector("div[class*='Price'], div[class*='price'], span[class*='Price'], span[class*='price']");
        const priceText = priceEl?.textContent || itemText;
        const priceMatch = priceText.match(/[₹]?\s*([\d,]+(?:\.\d+)?)/);
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(/,/g, "")) || 0;
        }

        const variantEl = itemEl.querySelector(
          "div[class*='Variant'], div[class*='variant'], div[class*='Weight'], " +
          "div[class*='weight'], div[class*='Size'], span[class*='variant']"
        );
        const variant = variantEl?.textContent?.trim() || undefined;

        const imgEl = itemEl.querySelector("img");
        const imageUrl = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || undefined;

        if (name && name !== "Unknown Item" && name.length > 2) {
          items.push({
            product_id: productId,
            name,
            quantity,
            original_price: price,
            variant,
            image_url: imageUrl,
          });
        }
      }
    }

    // Strategy 2: If no items found, try parsing from structured lists
    if (items.length === 0) {
      const listItems = doc.querySelectorAll("li, div[role='listitem']");
      for (const li of listItems) {
        const liText = li.textContent || "";

        const qtyPriceMatch = liText.match(/^(.+?)\s+(\d+)\s*x\s*[₹]?\s*([\d,]+(?:\.\d+)?)/i);
        if (qtyPriceMatch) {
          const name = qtyPriceMatch[1].trim();
          const quantity = parseInt(qtyPriceMatch[2], 10) || 1;
          const price = parseFloat(qtyPriceMatch[3].replace(/,/g, "")) || 0;

          const imgEl = li.querySelector("img");
          const imageUrl = imgEl?.getAttribute("src") || undefined;

          items.push({
            name,
            quantity,
            original_price: price,
            image_url: imageUrl,
          });
        }
      }
    }

    // Extract item count
    let itemCount = items.length;
    const itemCountMatch = bodyText.match(/(\d+)\s+items?/i);
    if (itemCountMatch) {
      itemCount = parseInt(itemCountMatch[1], 10) || items.length;
    }

    return {
      order_id: orderId,
      date,
      total,
      item_count: itemCount,
      status,
      items,
    };
  }, orderId);

  log(`Extracted order details with ${orderDetails.items.length} items`);
  return orderDetails;
}

/**
 * Track a specific order or the most recent one.
 * Navigates to the order details page and returns tracking information.
 */
export async function trackOrder(page: Page, orderId?: string): Promise<Record<string, unknown>> {
  const url = orderId
    ? `https://blinkit.com/order/${orderId}`
    : "https://blinkit.com/orders";

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(SELECTORS.ORDER_CARD, { timeout: 10000 }).catch(() => null);

  if (!orderId) {
    try {
      await page.locator(SELECTORS.ORDER_CARD).first().click();
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
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
