import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { OrderService } from "../../services/order-service.ts";

export const checkoutTool = {
  name: "checkout",
  description: "Proceed to checkout from cart. Returns next_step hint: 'select_address' if address selection needed, 'payment' if ready for payment. Automatically navigates past intermediate screens (delivery tip, etc.).",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
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
