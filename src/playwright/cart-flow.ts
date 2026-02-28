import type { Page } from "playwright";
import { isStoreClosed, extractPrice } from "./helpers.ts";
import { getKnownProducts, reSearchProduct } from "./search-flow.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

/**
 * Add a product to cart by its product ID on the current page.
 * Uses known products map for cross-search recovery if product is not visible.
 */
export async function addToCart(
  page: Page,
  productId: string,
  quantity: number
): Promise<{ success: boolean; cart_total: number; item_name: string; quantity_added: number }> {
  // Check store availability first
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    throw new Error(`CRITICAL: ${storeStatus}`);
  }

  // Target the specific product card by its ID attribute
  let card = page.locator(`div[id='${productId}']`);

  if (await card.count() === 0) {
    log(`Product ${productId} not found on current page.`);

    // Check known products for recovery via re-search
    const knownProducts = getKnownProducts();
    const known = knownProducts.get(productId);
    if (known?.sourceQuery) {
      log(`Product found in history. Re-searching for '${known.sourceQuery}'...`);
      await reSearchProduct(page, known.sourceQuery);

      // Re-locate the card after search
      card = page.locator(`div[id='${productId}']`);
      if (await card.count() === 0) {
        log(`CRITICAL: Product ${productId} still not found after re-search.`);
        throw new Error(`Product ${productId} not found after re-search`);
      }
    } else {
      log("Product ID unknown and not on current page.");
      throw new Error(`Product ${productId} not found on page and not in search history`);
    }
  }

  // Check if item is already in cart (quantity controls visible instead of ADD)
  const addBtn = card.locator("div").filter({ hasText: "ADD" }).last();
  const alreadyInCart = await card.locator(".icon-plus, .icon-minus").count() > 0;
  let itemsToAdd = quantity;
  let actualAdded = 0;

  if (alreadyInCart) {
    log(`Product ${productId} is already in cart. Using +/- controls to adjust quantity.`);
  }

  // If ADD button is visible (not yet in cart), click it once to start
  if (!alreadyInCart && await addBtn.isVisible().catch(() => false)) {
    await addBtn.click();
    log(`Clicked ADD for product ${productId} (1/${quantity}).`);
    itemsToAdd--;
    actualAdded++;
    await page.waitForTimeout(800);
  }

  // Use increment button for remaining quantity (or all of it if already in cart)
  if (itemsToAdd > 0) {
    if (!alreadyInCart) await page.waitForTimeout(500);

    // Find the + button — click the icon element directly (not parent)
    const plusIcon = card.locator(".icon-plus").first();
    if (await plusIcon.count() === 0) {
      // Fallback: try text-based + button
      const plusText = card.locator("button, div, span").filter({ hasText: /^\+$/ }).first();
      if (await plusText.count() === 0) {
        if (actualAdded === 0) {
          throw new Error(`Product ${productId}: cannot find ADD or + button. Item may be out of stock.`);
        }
        log(`Could not find + button for remaining quantity, but ${actualAdded} already added.`);
      } else {
        for (let i = 0; i < itemsToAdd; i++) {
          await plusText.click();
          actualAdded++;
          log(`Incrementing via text + for ${productId} (${actualAdded}/${quantity}).`);
          await page.waitForTimeout(500);
        }
      }
    } else {
      for (let i = 0; i < itemsToAdd; i++) {
        await plusIcon.click();
        actualAdded++;
        log(`Incrementing quantity for ${productId} (${actualAdded}/${quantity}).`);

        // Check for quantity limit
        try {
          const limitMsg = page.getByText("Sorry, you can't add more of this item");
          if (await limitMsg.isVisible({ timeout: 1000 }).catch(() => false)) {
            log(`Quantity limit reached for ${productId}.`);
            return {
              success: true,
              cart_total: 0,
              item_name: productId,
              quantity_added: actualAdded,
            };
          }
        } catch {
          // No limit message, continue
        }

        await page.waitForTimeout(500);
      }
    }
  }

  await page.waitForTimeout(1000);

  // Check for store unavailable modal after adding
  if (await page.isVisible("text=\"Sorry, can't take your order\"").catch(() => false)) {
    throw new Error("WARNING: Store is unavailable (modal detected after add).");
  }

  return {
    success: true,
    cart_total: 0,
    item_name: productId,
    quantity_added: actualAdded > 0 ? actualAdded : quantity,
  };
}

/**
 * Get cart contents by opening the cart drawer.
 */
export async function getCart(page: Page): Promise<{
  items: any[];
  subtotal: number;
  total: number;
  delivery_fee: number;
  item_count: number;
  raw_cart_text?: string;
  warning?: string;
}> {
  // Click the cart button to open the cart drawer
  const cartBtn = page.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
  if (await cartBtn.count() > 0) {
    await cartBtn.first().click();
    await page.waitForTimeout(2000);
  } else {
    return { items: [], subtotal: 0, delivery_fee: 0, total: 0, item_count: 0, warning: "Cart button not found." };
  }

  // 1. Critical availability check
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    return { items: [], subtotal: 0, delivery_fee: 0, total: 0, item_count: 0, warning: `CRITICAL: ${storeStatus}` };
  }

  // 2. Check for cart activity indicators
  const isCartActive =
    await page.isVisible("text=/Bill details/i").catch(() => false) ||
    await page.isVisible("button:has-text('Proceed')").catch(() => false) ||
    await page.isVisible("text='ordering for'").catch(() => false);

  // Scrape cart content from the drawer
  const drawer = page.locator(
    "div[class*='CartDrawer'], div[class*='CartSidebar'], div.cart-modal-rn, div[class*='CartWrapper__CartContainer']"
  ).first();

  let cartText = "";
  if (await drawer.count() > 0) {
    cartText = await drawer.innerText().catch(() => "");
    if (cartText.includes("Currently unavailable") || cartText.includes("can't take your order")) {
      return { items: [], subtotal: 0, delivery_fee: 0, total: 0, item_count: 0, warning: "CRITICAL: Store is unavailable (detected in cart)." };
    }
  }

  if (!isCartActive && !cartText.includes("\u20B9")) {
    return { items: [], subtotal: 0, delivery_fee: 0, total: 0, item_count: 0, warning: "Cart seems empty or store is unavailable." };
  }

  // Parse total from cart text
  let total = 0;
  const totalMatch = cartText.match(/(?:Grand Total|Total|To Pay)[^\d\u20B9]*[\u20B9]?\s*([\d,.]+)/i);
  if (totalMatch) {
    total = extractPrice(totalMatch[1]);
  }

  return {
    items: [],
    subtotal: total,
    delivery_fee: 0,
    total,
    item_count: 0,
    raw_cart_text: cartText,
  };
}

/**
 * Update a cart item's quantity on the current page.
 */
export async function updateCartItem(
  page: Page,
  productId: string,
  quantity: number
): Promise<{ success: boolean; new_quantity: number }> {
  const card = page.locator(`div[id='${productId}']`);

  if (await card.count() === 0) {
    throw new Error(`Product ${productId} not found on page`);
  }

  if (quantity === 0) {
    // Remove: click minus until ADD reappears
    while (true) {
      const minusBtn = card.locator(".icon-minus").first();
      if (await minusBtn.count() === 0) break;
      await minusBtn.locator("..").click();
      await page.waitForTimeout(500);
      if (await card.locator("div").filter({ hasText: "ADD" }).last().isVisible().catch(() => false)) {
        break;
      }
    }
    return { success: true, new_quantity: 0 };
  }

  return { success: true, new_quantity: quantity };
}

/**
 * Remove items from cart by decrementing quantity.
 * Uses known products for re-search recovery if not on page.
 */
export async function removeFromCart(
  page: Page,
  productId: string,
  quantity: number
): Promise<{ success: boolean }> {
  let card = page.locator(`div[id='${productId}']`);

  if (await card.count() === 0) {
    // Attempt recovery via known products re-search
    const knownProducts = getKnownProducts();
    const known = knownProducts.get(productId);
    if (known?.sourceQuery) {
      await reSearchProduct(page, known.sourceQuery);
      card = page.locator(`div[id='${productId}']`);
      if (await card.count() === 0) {
        throw new Error(`Product ${productId} not found after recovery search.`);
      }
    } else {
      throw new Error(`Product ${productId} not found and unknown.`);
    }
  }

  // Find the minus button
  const minusBtn = card.locator(".icon-minus").first();
  let minusClickable;
  if (await minusBtn.count() > 0) {
    minusClickable = minusBtn.locator("..");
  } else {
    minusClickable = card.locator("text='-'").first();
  }

  if (await minusClickable.isVisible().catch(() => false)) {
    for (let i = 0; i < quantity; i++) {
      await minusClickable.click();
      log(`Decrementing quantity for ${productId} (${i + 1}/${quantity}).`);
      await page.waitForTimeout(500);

      // If ADD button reappears, item is fully removed
      if (await card.locator("div").filter({ hasText: "ADD" }).last().isVisible().catch(() => false)) {
        log(`Item ${productId} completely removed from cart.`);
        break;
      }
    }
    return { success: true };
  } else {
    throw new Error(`Item ${productId} is not in cart (no '-' button found).`);
  }
}

/**
 * Clear entire cart by clicking minus on all items in the cart drawer.
 */
export async function clearCart(page: Page): Promise<{ success: boolean; items_cleared: number }> {
  const cartBtn = page.locator("div[class*='CartButton__Button'], div[class*='CartButton__Container']");
  if (await cartBtn.count() > 0) {
    await cartBtn.first().click();
    await page.waitForTimeout(2000);
  }

  let removed = 0;
  while (true) {
    const minusBtns = page.locator(".icon-minus");
    const btnCount = await minusBtns.count();
    if (btnCount === 0) break;
    await minusBtns.first().locator("..").click();
    await page.waitForTimeout(500);
    removed++;
    if (removed > 100) break; // Safety limit
  }

  return { success: true, items_cleared: removed };
}
