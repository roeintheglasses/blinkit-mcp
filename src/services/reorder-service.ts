import type { AppContext, OrderDetails, Product } from "../types.ts";
import {
  getOrders as getOrdersFlow,
  getOrderDetails as getOrderDetailsFlow,
} from "../playwright/checkout-flow.ts";
import { ProductService } from "./product-service.ts";

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

    // Step 2: Item search and availability checking
    const productService = new ProductService(this.ctx);
    const excludeSet = new Set(
      (excludeItems ?? []).map((item) => item.toLowerCase().trim())
    );

    // Track items to add and those unavailable
    const itemsToAdd: Array<{
      product: Product;
      quantity: number;
      original_price: number;
    }> = [];
    const unavailableItems: Array<{
      name: string;
      reason: string;
      alternatives?: Array<{
        id: string;
        name: string;
        price: number;
        in_stock: boolean;
      }>;
    }> = [];
    const priceChanges: Array<{
      name: string;
      old_price: number;
      new_price: number;
    }> = [];

    // Process each item from the order
    for (const orderItem of targetOrder.items) {
      // Check if item is in exclude list
      if (excludeSet.has(orderItem.name.toLowerCase().trim())) {
        this.ctx.logger.debug(`Skipping excluded item: ${orderItem.name}`);
        continue;
      }

      try {
        // Search for the item
        const searchResults = await productService.search(orderItem.name, 5);

        if (searchResults.products.length === 0) {
          unavailableItems.push({
            name: orderItem.name,
            reason: "Product not found in current catalog",
          });
          continue;
        }

        // Try to match by product_id first, then by name similarity
        let matchedProduct: Product | null = null;

        if (orderItem.product_id) {
          matchedProduct = searchResults.products.find(
            (p) => p.id === orderItem.product_id
          ) ?? null;
        }

        // If no exact ID match, take the first result (best name match)
        if (!matchedProduct) {
          matchedProduct = searchResults.products[0];
        }

        // Check availability
        if (!matchedProduct.in_stock) {
          unavailableItems.push({
            name: orderItem.name,
            reason: "Out of stock",
          });
          continue;
        }

        // Track for adding to cart
        itemsToAdd.push({
          product: matchedProduct,
          quantity: orderItem.quantity,
          original_price: orderItem.original_price,
        });

        // Check for price changes
        if (matchedProduct.price !== orderItem.original_price) {
          priceChanges.push({
            name: matchedProduct.name,
            old_price: orderItem.original_price,
            new_price: matchedProduct.price,
          });
        }
      } catch (error) {
        this.ctx.logger.debug(`Failed to search for item ${orderItem.name}:`, error);
        unavailableItems.push({
          name: orderItem.name,
          reason: "Search failed",
        });
      }
    }

    // TODO: Implement subsequent steps in following subtasks:
    // 3. Cart population with batch add
    // 4. Alternative product suggestions for unavailable items

    return {
      success: false,
      items_added: [],
      unavailable_items: unavailableItems,
      price_changes: priceChanges,
      cart_total: 0,
    };
  }
}
