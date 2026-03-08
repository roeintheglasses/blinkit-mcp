import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const clearCartTool = {
  name: "clear_cart",
  description: "Empty the entire Blinkit cart. Requires authentication.",
  inputSchema: {},
  handler: requireAuth(async (_input: {}, ctx: AppContext) => {
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
  }),
};
