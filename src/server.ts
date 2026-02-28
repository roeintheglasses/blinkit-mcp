import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./types.js";

// Auth tools
import { checkLoginStatusTool } from "./tools/auth/check-login-status.js";
import { loginTool } from "./tools/auth/login.js";
import { enterOtpTool } from "./tools/auth/enter-otp.js";
import { logoutTool } from "./tools/auth/logout.js";

// Location tools
import { setLocationTool } from "./tools/location/set-location.js";
import { getSavedAddressesTool } from "./tools/location/get-saved-addresses.js";
import { selectAddressTool } from "./tools/location/select-address.js";

// Browse tools
import { searchProductsTool } from "./tools/browse/search-products.js";
import { getProductDetailsTool } from "./tools/browse/get-product-details.js";
import { browseCategoriesToolDef } from "./tools/browse/browse-categories.js";
import { browseCategoryTool } from "./tools/browse/browse-category.js";

// Cart tools
import { getCartTool } from "./tools/cart/get-cart.js";
import { addToCartTool } from "./tools/cart/add-to-cart.js";
import { updateCartItemTool } from "./tools/cart/update-cart-item.js";
import { removeFromCartTool } from "./tools/cart/remove-from-cart.js";
import { clearCartTool } from "./tools/cart/clear-cart.js";

// Order tools
import { checkoutTool } from "./tools/orders/checkout.js";
import { getOrderHistoryTool } from "./tools/orders/get-order-history.js";
import { trackOrderTool } from "./tools/orders/track-order.js";
import { getPaymentMethodsTool } from "./tools/orders/get-payment-methods.js";
import { selectPaymentMethodTool } from "./tools/orders/select-payment-method.js";
import { payNowTool } from "./tools/orders/pay-now.js";
import { quickUpiCheckoutTool } from "./tools/orders/quick-upi-checkout.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, import("zod").ZodType>;
  handler: (input: any, ctx: AppContext) => Promise<{
    content: ContentBlock[];
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
  getPaymentMethodsTool,
  selectPaymentMethodTool,
  payNowTool,
  quickUpiCheckoutTool,
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

          let errorText = `Error: ${message}`;

          if (ctx.config.screenshot_on_error) {
            const screenshotPath = await ctx.browserManager.captureErrorScreenshot(tool.name);
            if (screenshotPath) {
              errorText += `\n\nDebug screenshot saved to: ${screenshotPath}`;
            }
          }

          return {
            content: [{ type: "text" as const, text: errorText }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
