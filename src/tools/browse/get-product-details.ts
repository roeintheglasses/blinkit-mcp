import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { ProductService } from "../../services/product-service.ts";

export const getProductDetailsTool = {
  name: "get_product_details",
  description: "Get full details for a Blinkit product by its ID. Returns name, price, description, brand, images, nutrition info, and availability.",
  inputSchema: {
    product_id: z.string().min(1, "Product ID is required"),
  },
  handler: async (input: { product_id: string }, ctx: AppContext) => {
    const productService = new ProductService(ctx);
    const details = await productService.getDetails(input.product_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(details, null, 2),
        },
      ],
    };
  },
};
