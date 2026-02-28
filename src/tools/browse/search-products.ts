import { z } from "zod";
import type { AppContext } from "../../types.js";
import { ProductService } from "../../services/product-service.js";

export const searchProductsTool = {
  name: "search_products",
  description: "Search for products on Blinkit by query string. Returns product names, prices, and IDs.",
  inputSchema: {
    query: z.string().min(1, "Search query cannot be empty"),
    limit: z.number().int().min(1).max(50).default(10),
  },
  handler: async (input: { query: string; limit: number }, ctx: AppContext) => {
    const productService = new ProductService(ctx);
    const results = await productService.search(input.query, input.limit);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              query: input.query,
              total_results: results.total_results,
              products: results.products,
            },
            null,
            2
          ),
        },
      ],
    };
  },
};
