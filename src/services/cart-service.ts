import type { AppContext, Cart } from "../types.js";
import {
  getCart as getCartFlow,
  addToCart as addToCartFlow,
  updateCartItem as updateCartItemFlow,
  removeFromCart as removeFromCartFlow,
  clearCart as clearCartFlow,
} from "../playwright/cart-flow.js";

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

    // Get updated cart to check spending
    const cart = await this.getCart();
    const spendingCheck = this.ctx.spendingGuard.check(cart.total);

    return {
      success: result.success,
      cart_total: cart.total,
      item_name: result.item_name,
      quantity_added: result.quantity_added,
      spending_warning: spendingCheck.warning,
    };
  }

  async updateCartItem(
    productId: string,
    quantity: number
  ): Promise<Cart> {
    const page = await this.ctx.browserManager.ensurePage();
    await updateCartItemFlow(page, productId, quantity);
    return this.getCart();
  }

  async removeFromCart(
    productId: string,
    quantity = 1
  ): Promise<{ success: boolean; removed_item: string; new_cart_total: number }> {
    const page = await this.ctx.browserManager.ensurePage();
    await removeFromCartFlow(page, productId, quantity);

    const cart = await this.getCart();
    return {
      success: true,
      removed_item: productId,
      new_cart_total: cart.total,
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
