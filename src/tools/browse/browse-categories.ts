import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { ProductService } from "../../services/product-service.ts";

export const browseCategoriesToolDef = {
  name: "browse_categories",
  description: "List top-level product categories on Blinkit. Returns category names and IDs.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    const productService = new ProductService(ctx);
    const categories = await productService.browseCategories();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(categories, null, 2),
        },
      ],
    };
  },
};
