import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { OrderService } from "../../services/order-service.ts";

export const getOrderHistoryTool = {
  name: "get_order_history",
  description: "View past Blinkit orders. Returns order IDs, dates, totals, and status. Requires authentication.",
  inputSchema: {
    limit: z.number().int().min(1).max(20).default(5),
  },
  handler: async (input: { limit: number }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const orderService = new OrderService(ctx);
    const orders = await orderService.getOrderHistory(input.limit);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(orders, null, 2),
        },
      ],
    };
  },
};
