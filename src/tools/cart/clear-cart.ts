import { z } from "zod";
import type { AppContext } from "../../types.js";
import { CartService } from "../../services/cart-service.js";

export const clearCartTool = {
  name: "clear_cart",
  description: "Empty the entire Blinkit cart. Requires authentication.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const cartService = new CartService(ctx);
    const result = await cartService.clearCart();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  },
};
