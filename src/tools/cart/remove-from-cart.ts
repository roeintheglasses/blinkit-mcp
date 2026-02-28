import { z } from "zod";
import type { AppContext } from "../../types.js";
import { CartService } from "../../services/cart-service.js";

export const removeFromCartTool = {
  name: "remove_from_cart",
  description: "Remove a specific quantity of a product from your Blinkit cart. Defaults to removing 1.",
  inputSchema: {
    product_id: z.string().min(1, "Product ID is required"),
    quantity: z.number().int().min(1).default(1).describe("Number of items to remove (default 1)"),
  },
  handler: async (input: { product_id: string; quantity: number }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const cartService = new CartService(ctx);
    const result = await cartService.removeFromCart(input.product_id, input.quantity);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
