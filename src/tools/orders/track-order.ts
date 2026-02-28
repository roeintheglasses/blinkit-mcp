import { z } from "zod";
import type { AppContext } from "../../types.js";
import { OrderService } from "../../services/order-service.js";

export const trackOrderTool = {
  name: "track_order",
  description:
    "Get real-time tracking status of a Blinkit order. If no order_id provided, tracks the most recent order. Requires authentication.",
  inputSchema: {
    order_id: z.string().optional(),
  },
  handler: async (input: { order_id?: string }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const orderService = new OrderService(ctx);
    const tracking = await orderService.trackOrder(input.order_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(tracking, null, 2),
        },
      ],
    };
  },
};
