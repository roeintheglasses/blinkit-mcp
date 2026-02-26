import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { OrderService } from "../../services/order-service.ts";

export const checkoutTool = {
  name: "checkout",
  description: "Proceed to checkout. Clicks the Proceed/Checkout button. Triggers address selection if needed.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
        isError: true,
      };
    }

    const orderService = new OrderService(ctx);
    const result = await orderService.checkout();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
