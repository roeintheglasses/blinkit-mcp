import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";

export const addToCartTool = {
  name: "add_to_cart",
  description: "Add a product to Blinkit cart by product ID. Optionally specify quantity. Requires authentication.",
  inputSchema: {
    product_id: z.string().min(1, "Product ID is required"),
    quantity: z.number().int().min(1).default(1),
  },
  handler: async (input: { product_id: string; quantity: number }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
        isError: true,
      };
    }

    const cartService = new CartService(ctx);
    const result = await cartService.addToCart(input.product_id, input.quantity);

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
