import type { AppContext, OrderDetails } from "../types.ts";
import {
  getOrders as getOrdersFlow,
  getOrderDetails as getOrderDetailsFlow,
} from "../playwright/checkout-flow.ts";

export class ReorderService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async reorder(
    orderIdOrLast: string = "last",
    excludeItems?: string[]
  ): Promise<{
    success: boolean;
    items_added: Array<{
      name: string;
      quantity: number;
      price: number;
      price_changed?: boolean;
      old_price?: number;
    }>;
    unavailable_items: Array<{
      name: string;
      reason: string;
      alternatives?: Array<{
        id: string;
        name: string;
        price: number;
        in_stock: boolean;
      }>;
    }>;
    price_changes: Array<{
      name: string;
      old_price: number;
      new_price: number;
    }>;
    cart_total: number;
    spending_warning?: string;
  }> {
    // Step 1: Retrieve the target order (by ID or 'last')
    const page = await this.ctx.browserManager.ensurePage();
    let targetOrder: OrderDetails;

    if (orderIdOrLast === "last") {
      // Get the most recent order from history
      const orders = await getOrdersFlow(page, 1);
      if (orders.length === 0) {
        throw new Error("No orders found in order history");
      }
      targetOrder = orders[0];
    } else {
      // Get specific order by ID
      // First try to find it in recent history (more efficient)
      const recentOrders = await getOrdersFlow(page, 10);
      const foundOrder = recentOrders.find(
        (order) => order.order_id === orderIdOrLast
      );

      if (foundOrder) {
        targetOrder = foundOrder;
      } else {
        // Order not in recent history, fetch it directly
        targetOrder = await getOrderDetailsFlow(page, orderIdOrLast);
      }
    }

    if (!targetOrder.items || targetOrder.items.length === 0) {
      throw new Error(
        `Order ${targetOrder.order_id} has no items to reorder`
      );
    }

    // TODO: Implement subsequent steps in following subtasks:
    // 2. Item search and availability checking
    // 3. Cart population with batch add
    // 4. Alternative product suggestions
    // 5. Price comparison

    return {
      success: false,
      items_added: [],
      unavailable_items: [],
      price_changes: [],
      cart_total: 0,
    };
  }
}
