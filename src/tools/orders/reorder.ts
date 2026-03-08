import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { ReorderService } from "../../services/reorder-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const reorderTool = {
  name: "reorder",
  description: "Reorder items from a previous Blinkit order. Specify 'last' (default) or an order ID. Optionally exclude specific items. Returns added items, unavailable items with alternatives, price changes, and cart total. Requires authentication.",
  inputSchema: {
    order_id: z.string().default("last"),
    exclude_items: z.array(z.string()).optional(),
  },
  handler: requireAuth(async (input: { order_id: string; exclude_items?: string[] }, ctx: AppContext) => {
    const reorderService = new ReorderService(ctx);
    const result = await reorderService.reorder(input.order_id, input.exclude_items);

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
