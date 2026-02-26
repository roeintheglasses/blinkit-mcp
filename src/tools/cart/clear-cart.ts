import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";

export const clearCartTool = {
  name: "clear_cart",
  description: "Empty the entire Blinkit cart. Requires authentication.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
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
