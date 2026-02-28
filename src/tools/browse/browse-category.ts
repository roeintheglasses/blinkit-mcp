import { z } from "zod";
import type { AppContext } from "../../types.js";
import { ProductService } from "../../services/product-service.js";

export const browseCategoryTool = {
  name: "browse_category",
  description:
    "Get products within a specific Blinkit category. Use browse_categories to find category IDs first.",
  inputSchema: {
    category_id: z.string().min(1, "Category ID is required"),
    subcategory_id: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  },
  handler: async (
    input: { category_id: string; subcategory_id?: string; limit: number },
    ctx: AppContext
  ) => {
    const productService = new ProductService(ctx);
    const id = input.subcategory_id ?? input.category_id;
    const results = await productService.browseCategory(id, input.limit);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  },
};
