import type { AppContext, OrderSummary, OrderTracking } from "../types.js";
import { getCart as getCartFlow } from "../playwright/cart-flow.js";
import {
  checkout as checkoutFlow,
  getOrders as getOrdersFlow,
  trackOrder as trackOrderFlow,
} from "../playwright/checkout-flow.js";

export class OrderService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async checkout(): Promise<Record<string, unknown>> {
    // Check spending guard first
    const page = await this.ctx.browserManager.ensurePage();
    let cartTotal = 0;
    try {
      const cartData = await getCartFlow(page);
      cartTotal = cartData.total;
      const spendingCheck = this.ctx.spendingGuard.check(cartTotal);
      if (spendingCheck.exceeded_hard_limit) {
        return {
          success: false,
          blocked: true,
          message: spendingCheck.warning,
        };
      }
    } catch {
      // Continue with checkout even if cart check fails
    }

    const data = await checkoutFlow(page) as Record<string, unknown>;

    // Add spending warning if applicable
    if (cartTotal > 0) {
      const spendingCheck = this.ctx.spendingGuard.check(cartTotal);
      if (spendingCheck.warning) {
        data.spending_warning = spendingCheck.warning;
      }
    }

    return data;
  }

  async getOrderHistory(limit = 5): Promise<OrderSummary[]> {
    const page = await this.ctx.browserManager.ensurePage();
    const orders = await getOrdersFlow(page, limit);
    return orders as unknown as OrderSummary[];
  }

  async trackOrder(orderId?: string): Promise<OrderTracking> {
    const page = await this.ctx.browserManager.ensurePage();
    const data = await trackOrderFlow(page, orderId);
    return data as unknown as OrderTracking;
  }
}
