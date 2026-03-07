import type { AppContext, Cart } from "../types.ts";
import {
  getCart as getCartFlow,
  addToCart as addToCartFlow,
  updateCartItem as updateCartItemFlow,
  removeFromCart as removeFromCartFlow,
  clearCart as clearCartFlow,
} from "../playwright/cart-flow.ts";

export class CartService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getCart(): Promise<Cart> {
    const page = await this.ctx.browserManager.ensurePage();
    const data = await getCartFlow(page);

    const cart: Cart = {
      items: data.items,
      subtotal: data.subtotal,
      delivery_fee: data.delivery_fee,
      handling_fee: data.handling_fee,
      total: data.total,
      item_count: data.item_count,
      warning: data.warning,
    };

    // Check spending
    const spendingCheck = this.ctx.spendingGuard.check(cart.total);
    if (spendingCheck.warning) {
      cart.spending_warning = spendingCheck.warning;
    }

    return cart;
  }

  async addToCart(
    productId: string,
    quantity = 1
  ): Promise<{
    success: boolean;
    cart_total: number;
    item_name: string;
    quantity_added: number;
    limit_reached?: boolean;
    spending_warning?: string;
  }> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await addToCartFlow(page, productId, quantity);

    // Performance optimization: Use cart_total returned by addToCartFlow instead of calling
    // getCart() again. This avoids redundant cart drawer opening and 2-second wait, cutting
    // add-to-cart latency nearly in half. The flow already has the updated cart total visible.
    const spendingCheck = this.ctx.spendingGuard.check(result.cart_total);

    return {
      success: result.success,
      cart_total: result.cart_total,
      item_name: result.item_name,
      quantity_added: result.quantity_added,
      spending_warning: spendingCheck.warning,
    };
  }

  async updateCartItem(
    productId: string,
    quantity: number
  ): Promise<{ success: boolean; new_quantity: number; cart_total: number; spending_warning?: string }> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await updateCartItemFlow(page, productId, quantity);

    // Performance optimization: Use cart_total returned by updateCartItemFlow instead of
    // calling getCart() again. This avoids redundant cart drawer opening and 2-second wait.
    const spendingCheck = this.ctx.spendingGuard.check(result.cart_total);

    return {
      success: result.success,
      new_quantity: result.new_quantity,
      cart_total: result.cart_total,
      spending_warning: spendingCheck.warning,
    };
  }

  async removeFromCart(
    productId: string,
    quantity = 1
  ): Promise<{ success: boolean; removed_item: string; new_cart_total: number }> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await removeFromCartFlow(page, productId, quantity);

    // Performance optimization: Use cart_total returned by removeFromCartFlow instead of
    // calling getCart() again. This avoids redundant cart drawer opening and 2-second wait.
    return {
      success: result.success,
      removed_item: productId,
      new_cart_total: result.cart_total,
    };
  }

  async clearCart(): Promise<{ success: boolean; items_removed_count: number }> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await clearCartFlow(page);

    return {
      success: result.success,
      items_removed_count: result.items_cleared,
    };
  }
}
