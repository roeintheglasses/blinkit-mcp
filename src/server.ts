import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./types.ts";

// Auth tools
import { checkLoginStatusTool } from "./tools/auth/check-login-status.ts";
import { loginTool } from "./tools/auth/login.ts";
import { enterOtpTool } from "./tools/auth/enter-otp.ts";
import { logoutTool } from "./tools/auth/logout.ts";

// Location tools
import { setLocationTool } from "./tools/location/set-location.ts";
import { getSavedAddressesTool } from "./tools/location/get-saved-addresses.ts";
import { selectAddressTool } from "./tools/location/select-address.ts";

// Browse tools
import { searchProductsTool } from "./tools/browse/search-products.ts";
import { getProductDetailsTool } from "./tools/browse/get-product-details.ts";
import { browseCategoriesToolDef } from "./tools/browse/browse-categories.ts";
import { browseCategoryTool } from "./tools/browse/browse-category.ts";

// Cart tools
import { getCartTool } from "./tools/cart/get-cart.ts";
import { addToCartTool } from "./tools/cart/add-to-cart.ts";
import { updateCartItemTool } from "./tools/cart/update-cart-item.ts";
import { removeFromCartTool } from "./tools/cart/remove-from-cart.ts";
import { clearCartTool } from "./tools/cart/clear-cart.ts";

// Order tools
import { checkoutTool } from "./tools/orders/checkout.ts";
import { getOrderHistoryTool } from "./tools/orders/get-order-history.ts";
import { trackOrderTool } from "./tools/orders/track-order.ts";
import { getUpiIdsTool } from "./tools/orders/get-upi-ids.ts";
import { selectUpiIdTool } from "./tools/orders/select-upi-id.ts";
import { payNowTool } from "./tools/orders/pay-now.ts";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, import("zod").ZodType>;
  handler: (input: any, ctx: AppContext) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
};

const ALL_TOOLS: ToolDef[] = [
  checkLoginStatusTool,
  loginTool,
  enterOtpTool,
  logoutTool,
  setLocationTool,
  getSavedAddressesTool,
  selectAddressTool,
  searchProductsTool,
  getProductDetailsTool,
  browseCategoriesToolDef,
  browseCategoryTool,
  getCartTool,
  addToCartTool,
  updateCartItemTool,
  removeFromCartTool,
  clearCartTool,
  checkoutTool,
  getOrderHistoryTool,
  trackOrderTool,
  getUpiIdsTool,
  selectUpiIdTool,
  payNowTool,
];

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer({
    name: "blinkit-mcp",
    version: "0.1.0",
  });

  for (const tool of ALL_TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema,
      async (input) => {
        try {
          return await tool.handler(input, ctx);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.logger.error(`Tool '${tool.name}' failed: ${message}`);
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
