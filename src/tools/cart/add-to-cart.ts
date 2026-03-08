import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { CartService } from "../../services/cart-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const addToCartTool = {
  name: "add_to_cart",
  description: "Add a product to Blinkit cart by product ID. Optionally specify quantity. Requires authentication.",
  inputSchema: {
    product_id: z.string().min(1, "Product ID is required"),
    quantity: z.number().int().min(1).default(1),
  },
  handler: requireAuth(async (input: { product_id: string; quantity: number }, ctx: AppContext) => {
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
  }),
};
