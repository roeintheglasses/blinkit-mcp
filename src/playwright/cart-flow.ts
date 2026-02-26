import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import { waitAndClick, extractNumber } from "./helpers.ts";
import { BLINKIT_BASE_URL } from "../constants.ts";
import type { CartItem } from "../types.ts";

export async function getCart(page: Page): Promise<{
  items: CartItem[];
  subtotal: number;
  delivery_fee: number;
  total: number;
}> {
  await page.goto(`${BLINKIT_BASE_URL}/checkout/cart`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // Check if cart is empty
  const emptyIndicator = await page.locator(SELECTORS.CART_EMPTY).count();
  if (emptyIndicator > 0) {
    return { items: [], subtotal: 0, delivery_fee: 0, total: 0 };
  }

  const items: CartItem[] = [];
  const cartItems = page.locator(SELECTORS.CART_ITEM);
  const count = await cartItems.count();

  for (let i = 0; i < count; i++) {
    try {
      const item = cartItems.nth(i);
      const name = await item.locator(SELECTORS.CART_ITEM_NAME).textContent().catch(() => null);
      const priceText = await item.locator(SELECTORS.CART_ITEM_PRICE).textContent().catch(() => null);
      const qtyText = await item.locator(SELECTORS.CART_ITEM_QTY).textContent().catch(() => null);

      const price = extractNumber(priceText);
      const quantity = parseInt(qtyText ?? "1", 10) || 1;

      items.push({
        product_id: `cart-item-${i}`,
        name: name?.trim() ?? "Unknown",
        quantity,
        unit_price: price,
        total_price: price * quantity,
        unit: "",
      });
    } catch {
      // Skip
    }
  }

  const totalText = await page.locator(SELECTORS.CART_TOTAL).last().textContent().catch(() => null);
  const total = extractNumber(totalText);

  return {
    items,
    subtotal: total,
    delivery_fee: 0,
    total,
  };
}

export async function addToCart(page: Page, productId: string, quantity: number): Promise<boolean> {
  // Navigate to product page and click ADD
  await page.goto(`${BLINKIT_BASE_URL}/prn/product/prid/${productId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  try {
    await waitAndClick(page, SELECTORS.PRODUCT_ADD_BTN, 5000);
    await page.waitForTimeout(1000);

    // Click plus button for additional quantity
    for (let i = 1; i < quantity; i++) {
      await waitAndClick(page, SELECTORS.CART_PLUS, 3000);
      await page.waitForTimeout(500);
    }

    return true;
  } catch {
    return false;
  }
}

export async function updateCartItem(page: Page, productId: string, quantity: number): Promise<boolean> {
  await page.goto(`${BLINKIT_BASE_URL}/checkout/cart`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  // If quantity is 0, remove
  if (quantity === 0) {
    return removeFromCart(page, productId);
  }

  // Find the item and adjust quantity using +/- buttons
  // This is a simplified approach — in practice we'd match by product name/id
  try {
    const items = page.locator(SELECTORS.CART_ITEM);
    const count = await items.count();

    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const qtyText = await item.locator(SELECTORS.CART_ITEM_QTY).textContent().catch(() => "1");
      const currentQty = parseInt(qtyText ?? "1", 10) || 1;

      if (quantity > currentQty) {
        for (let j = 0; j < quantity - currentQty; j++) {
          await item.locator(SELECTORS.CART_PLUS).click();
          await page.waitForTimeout(500);
        }
      } else if (quantity < currentQty) {
        for (let j = 0; j < currentQty - quantity; j++) {
          await item.locator(SELECTORS.CART_MINUS).click();
          await page.waitForTimeout(500);
        }
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function removeFromCart(page: Page, _productId: string): Promise<boolean> {
  try {
    await waitAndClick(page, SELECTORS.CART_REMOVE, 5000);
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}

export async function clearCart(page: Page): Promise<number> {
  await page.goto(`${BLINKIT_BASE_URL}/checkout/cart`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);

  let removed = 0;
  const removeButtons = page.locator(SELECTORS.CART_REMOVE);
  let count = await removeButtons.count();

  while (count > 0) {
    await removeButtons.first().click();
    await page.waitForTimeout(1000);
    removed++;
    count = await removeButtons.count();
  }

  // Also try clicking minus until empty
  const minusButtons = page.locator(SELECTORS.CART_MINUS);
  let minusCount = await minusButtons.count();
  while (minusCount > 0) {
    await minusButtons.first().click();
    await page.waitForTimeout(500);
    removed++;
    minusCount = await minusButtons.count();
  }

  return removed;
}
