import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";

export const getCartTool = {
  name: "get_cart",
  description: "View current Blinkit cart contents, item quantities, and total. Requires authentication.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
        isError: true,
      };
    }

    const cartService = new CartService(ctx);
    const cart = await cartService.getCart();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(cart, null, 2),
        },
      ],
    };
  },
};
