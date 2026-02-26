import type { AppContext, Cart } from "../types.ts";

export class CartService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getCart(): Promise<Cart> {
    const result = await this.ctx.browserManager.sendCommand("getCart", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to get cart");
    }

    const data = result.data as {
      items: Cart["items"];
      subtotal: number;
      delivery_fee: number;
      total: number;
    };

    const cart: Cart = {
      items: data.items,
      subtotal: data.subtotal,
      delivery_fee: data.delivery_fee,
      total: data.total,
      item_count: data.items.length,
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
    const result = await this.ctx.browserManager.sendCommand("addToCart", {
      productId,
      quantity,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to add to cart");
    }

    const bridgeData = result.data as { limit_reached?: boolean } | undefined;

    // Get updated cart to check spending
    const cart = await this.getCart();
    const spendingCheck = this.ctx.spendingGuard.check(cart.total);

    return {
      success: true,
      cart_total: cart.total,
      item_name: cart.items[cart.items.length - 1]?.name ?? "Item",
      quantity_added: quantity,
      ...(bridgeData?.limit_reached ? { limit_reached: true } : {}),
      spending_warning: spendingCheck.warning,
    };
  }

  async updateCartItem(
    productId: string,
    quantity: number
  ): Promise<Cart> {
    const result = await this.ctx.browserManager.sendCommand("updateCartItem", {
      productId,
      quantity,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to update cart item");
    }

    return this.getCart();
  }

  async removeFromCart(
    productId: string,
    quantity = 1
  ): Promise<{ success: boolean; removed_item: string; new_cart_total: number }> {
    const result = await this.ctx.browserManager.sendCommand("removeFromCart", {
      productId,
      quantity,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to remove from cart");
    }

    const cart = await this.getCart();
    return {
      success: true,
      removed_item: productId,
      new_cart_total: cart.total,
    };
  }

  async clearCart(): Promise<{ success: boolean; items_removed_count: number }> {
    const result = await this.ctx.browserManager.sendCommand("clearCart", {});

    if (!result.success) {
      throw new Error(result.error ?? "Failed to clear cart");
    }

    const data = result.data as { items_removed: number };
    return {
      success: true,
      items_removed_count: data.items_removed,
    };
  }
}
