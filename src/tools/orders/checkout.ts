import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { OrderService } from "../../services/order-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const checkoutTool = {
  name: "checkout",
  description: "Proceed to checkout from cart. Returns next_step hint: 'select_address' if address selection needed, 'payment' if ready for payment. Automatically navigates past intermediate screens (delivery tip, etc.).",
  inputSchema: {},
  handler: requireAuth(async (_input: {}, ctx: AppContext) => {
    const orderService = new OrderService(ctx);
    const result = await orderService.checkout();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }),
};
