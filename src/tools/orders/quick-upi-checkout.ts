import type { AppContext } from "../../types.js";
import { QuickCheckoutService } from "../../services/quick-checkout-service.js";

export const quickUpiCheckoutTool = {
  name: "quick_upi_checkout",
  description: "Performs the entire checkout flow in one call: opens cart, proceeds to checkout, auto-selects first address if needed, reaches payment, selects UPI, and returns the QR code.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const service = new QuickCheckoutService(ctx);
    const result = await service.quickUpiCheckout();

    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

    // Include QR code image if available (for clients that support images)
    if (result.qr_image_base64) {
      content.push({
        type: "image" as const,
        data: result.qr_image_base64,
        mimeType: "image/png",
      });
    }

    // Build text summary
    let text = "## Quick UPI Checkout\n\n";

    text += `**Cart:** ${result.cart_summary.item_count} item(s), Total: ₹${result.cart_summary.total}\n`;
    for (const item of result.cart_summary.items) {
      text += `  - ${item}\n`;
    }

    if (result.address_selected) {
      text += `\n**Address:** ${result.address_selected}\n`;
    }

    text += `\n**Steps completed:** ${result.steps_completed.join(" → ")}\n`;

    text += `\n**Payment methods:**\n`;
    for (const m of result.payment_methods) {
      text += `  - ${m.name} (${m.type})${m.available ? "" : " [unavailable]"}${m.details ? ` — ${m.details}` : ""}\n`;
    }

    // Include Unicode text art QR code (works in ALL clients including Claude Desktop)
    if (result.qr_text_art) {
      text += "\nScan this QR code with any UPI app:\n\n";
      text += "```\n" + result.qr_text_art + "```";
    }

    // Include file path as fallback
    if (result.qr_file_path) {
      text += `\nQR code also saved to: ${result.qr_file_path}`;
    }

    text += `\n\n**Next action:** ${result.next_action}`;

    if (result.spending_warning) {
      text += `\n\n⚠️ **Spending warning:** ${result.spending_warning}`;
    }

    content.push({ type: "text" as const, text });

    return { content };
  },
};
