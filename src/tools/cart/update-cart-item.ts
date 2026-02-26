import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";

export const updateCartItemTool = {
  name: "update_cart_item",
  description:
    "Change quantity of a cart item on Blinkit. Set quantity to 0 to remove the item. Requires authentication.",
  inputSchema: {
    product_id: z.string().min(1, "Product ID is required"),
    quantity: z.number().int().min(0),
  },
  handler: async (input: { product_id: string; quantity: number }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
        isError: true,
      };
    }

    const cartService = new CartService(ctx);
    const cart = await cartService.updateCartItem(input.product_id, input.quantity);

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
