import type { AppContext, OrderSummary, OrderTracking } from "../types.ts";

export class OrderService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async checkout(): Promise<Record<string, unknown>> {
    // Check spending guard first
    const cartResult = await this.ctx.browserManager.sendCommand("getCart", {});
    if (cartResult.success) {
      const cartData = cartResult.data as { total: number };
      const spendingCheck = this.ctx.spendingGuard.check(cartData.total);
      if (spendingCheck.exceeded_hard_limit) {
        return {
          success: false,
          blocked: true,
          message: spendingCheck.warning,
        };
      }
    }

    const result = await this.ctx.browserManager.sendCommand("checkout", {});

    if (!result.success) {
      throw new Error(result.error ?? "Checkout failed");
    }

    const data = result.data as Record<string, unknown>;

    // Add spending warning if applicable
    if (cartResult.success) {
      const cartData = cartResult.data as { total: number };
      const spendingCheck = this.ctx.spendingGuard.check(cartData.total);
      if (spendingCheck.warning) {
        data.spending_warning = spendingCheck.warning;
      }
    }

    return data;
  }

  async getOrderHistory(limit = 5): Promise<OrderSummary[]> {
    const result = await this.ctx.browserManager.sendCommand("getOrders", { limit });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to get order history");
    }

    const data = result.data as { orders: OrderSummary[] };
    return data.orders;
  }

  async trackOrder(orderId?: string): Promise<OrderTracking> {
    const result = await this.ctx.browserManager.sendCommand("trackOrder", {
      orderId,
    });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to track order");
    }

    return result.data as OrderTracking;
  }
}
