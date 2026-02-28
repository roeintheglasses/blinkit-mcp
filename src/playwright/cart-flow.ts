import type { Page } from "playwright";
import { isStoreClosed, extractPrice } from "./helpers.js";
import { getKnownProducts, reSearchProduct } from "./search-flow.js";
import { SELECTORS, productById } from "./selectors.js";

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
  let card = page.locator(productById(productId));

  if (await card.count() === 0) {
    log(`Product ${productId} not found on current page.`);

    // Check known products for recovery via re-search
    const knownProducts = getKnownProducts();
    const known = knownProducts.get(productId);
    if (known?.sourceQuery) {
      log(`Product found in history. Re-searching for '${known.sourceQuery}'...`);
      await reSearchProduct(page, known.sourceQuery);

      // Re-locate the card after search
      card = page.locator(productById(productId));
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
  const alreadyInCart = await card.locator(SELECTORS.ICON_PLUS_MINUS).count() > 0;
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
    const plusIcon = card.locator(SELECTORS.ICON_PLUS).first();
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
  if (await page.isVisible(SELECTORS.STORE_UNAVAILABLE_MODAL).catch(() => false)) {
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
  items: Array<{ name: string; variant: string; unit_price: number; quantity: number; total_price: number; image_url?: string }>;
  subtotal: number;
  total: number;
  delivery_fee: number;
  handling_fee: number;
  item_count: number;
  warning?: string;
}> {
  const emptyResult = { items: [] as any[], subtotal: 0, delivery_fee: 0, handling_fee: 0, total: 0, item_count: 0 };

  // Check if cart drawer is already open (e.g. after add-to-cart)
  const cartAlreadyOpen =
    await page.isVisible(SELECTORS.BILL_DETAILS_REGEX).catch(() => false) ||
    await page.locator(SELECTORS.CART_PRODUCT).count().then(c => c > 0).catch(() => false);

  if (!cartAlreadyOpen) {
    // Click the cart button to open the cart drawer
    const cartBtn = page.locator(SELECTORS.CART_BUTTON);
    if (await cartBtn.count() > 0) {
      try {
        await cartBtn.first().click({ force: true, timeout: 10000 });
      } catch {
        log("Cart button click failed, trying JavaScript click...");
        await cartBtn.first().evaluate((el: any) => el.click()).catch(() => {});
      }
      await page.waitForTimeout(2000);
    } else {
      return { ...emptyResult, warning: "Cart button not found." };
    }
  } else {
    log("Cart drawer is already open.");
  }

  // 1. Critical availability check
  const storeStatus = await isStoreClosed(page);
  if (storeStatus) {
    return { ...emptyResult, warning: `CRITICAL: ${storeStatus}` };
  }

  // 2. Check for cart activity indicators
  const isCartActive =
    await page.isVisible(SELECTORS.BILL_DETAILS_REGEX).catch(() => false) ||
    await page.isVisible(SELECTORS.PROCEED_HAS_TEXT).catch(() => false) ||
    await page.isVisible(SELECTORS.ORDERING_FOR).catch(() => false);

  if (!isCartActive) {
    return { ...emptyResult, warning: "Cart seems empty or store is unavailable." };
  }

  // 3. Parse individual cart items from CartProduct elements
  const items: Array<{ name: string; variant: string; unit_price: number; quantity: number; total_price: number; image_url?: string }> = [];
  const cartProducts = page.locator(SELECTORS.CART_PRODUCT);
  const productCount = await cartProducts.count();
  log(`Found ${productCount} items in cart drawer.`);

  for (let i = 0; i < productCount; i++) {
    try {
      const card = cartProducts.nth(i);
      const name = await card.locator(SELECTORS.CART_PRODUCT_TITLE).first().innerText().catch(() => "Unknown");
      const variant = await card.locator(SELECTORS.CART_PRODUCT_VARIANT).first().innerText().catch(() => "");
      const priceText = await card.locator(SELECTORS.CART_PRODUCT_PRICE).first().innerText().catch(() => "0");
      const unitPrice = extractPrice(priceText);
      const image_url = await card.locator("img").first().getAttribute("src").catch(() => undefined) ?? undefined;

      // Quantity is a raw text node between minus/plus button wrappers inside AddToCardContainer.
      // Text lines of the item: [name, variant, price, minusIcon, QUANTITY, plusIcon]
      let quantity = 1;
      const fullText = await card.innerText().catch(() => "");
      const lines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      // Find the standalone number(s) after the price — the first one is the quantity
      let foundPrice = false;
      for (const line of lines) {
        if (line.includes("₹")) { foundPrice = true; continue; }
        if (foundPrice && /^\d+$/.test(line)) {
          quantity = parseInt(line, 10);
          break;
        }
      }

      items.push({
        name,
        variant,
        unit_price: unitPrice,
        quantity,
        total_price: unitPrice * quantity,
        image_url,
      });
    } catch (e) {
      log(`Failed to parse cart item ${i}: ${e}`);
    }
  }

  // 4. Parse bill details
  let subtotal = 0;
  let deliveryFee = 0;
  let handlingFee = 0;
  let total = 0;

  const billElements = page.locator(SELECTORS.CART_BILL);
  const billTexts = await billElements.allInnerTexts().catch(() => []);
  // Find the full bill details text (contains "Items total" and "Grand total")
  const billText = billTexts.find(t => t.includes("Items total") && t.includes("Grand total")) || "";

  if (billText) {
    const itemsTotalMatch = billText.match(/Items total[^\d₹]*[₹]?\s*([\d,.]+)/i);
    if (itemsTotalMatch) subtotal = extractPrice(itemsTotalMatch[1]);

    const deliveryMatch = billText.match(/Delivery charge[^\d₹]*[₹]?\s*([\d,.]+)/i);
    if (deliveryMatch) deliveryFee = extractPrice(deliveryMatch[1]);

    const handlingMatch = billText.match(/Handling charge[^\d₹]*[₹]?\s*([\d,.]+)/i);
    if (handlingMatch) handlingFee = extractPrice(handlingMatch[1]);

    const totalMatch = billText.match(/Grand total[^\d₹]*[₹]?\s*([\d,.]+)/i);
    if (totalMatch) total = extractPrice(totalMatch[1]);
  }

  // Fallback: compute subtotal from items if bill parsing failed
  if (subtotal === 0 && items.length > 0) {
    subtotal = items.reduce((sum, item) => sum + item.total_price, 0);
  }
  if (total === 0) total = subtotal + deliveryFee + handlingFee;

  return {
    items,
    subtotal,
    delivery_fee: deliveryFee,
    handling_fee: handlingFee,
    total,
    item_count: items.length,
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
  const card = page.locator(productById(productId));

  if (await card.count() === 0) {
    throw new Error(`Product ${productId} not found on page`);
  }

  if (quantity === 0) {
    // Remove: click minus until ADD reappears
    while (true) {
      const minusBtn = card.locator(SELECTORS.ICON_MINUS).first();
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
  let card = page.locator(productById(productId));

  if (await card.count() === 0) {
    // Attempt recovery via known products re-search
    const knownProducts = getKnownProducts();
    const known = knownProducts.get(productId);
    if (known?.sourceQuery) {
      await reSearchProduct(page, known.sourceQuery);
      card = page.locator(productById(productId));
      if (await card.count() === 0) {
        throw new Error(`Product ${productId} not found after recovery search.`);
      }
    } else {
      throw new Error(`Product ${productId} not found and unknown.`);
    }
  }

  // Find the minus button
  const minusBtn = card.locator(SELECTORS.ICON_MINUS).first();
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
  const cartBtn = page.locator(SELECTORS.CART_BUTTON);
  if (await cartBtn.count() > 0) {
    await cartBtn.first().click();
    await page.waitForTimeout(2000);
  }

  let removed = 0;
  while (true) {
    const minusBtns = page.locator(SELECTORS.ICON_MINUS);
    const btnCount = await minusBtns.count();
    if (btnCount === 0) break;
    await minusBtns.first().locator("..").click();
    await page.waitForTimeout(500);
    removed++;
    if (removed > 100) break; // Safety limit
  }

  return { success: true, items_cleared: removed };
}
