import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const selectPaymentMethodTool = {
  name: "select_payment_method",
  description: "Select a payment method on the checkout page. Types: 'card' (credit/debit), 'upi' (QR code), 'netbanking', 'wallets', 'pay_later'. For UPI, this generates a QR code image saved locally and returned as an image. For card, it shows the saved card with CVV input.",
  inputSchema: {
    method_type: z.string().min(1).describe("Payment method type: 'card', 'upi', 'netbanking', 'wallets', 'cod', or 'pay_later'"),
  },
  handler: async (input: { method_type: string }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const paymentService = new PaymentService(ctx);
    const result = await paymentService.selectPaymentMethod(input.method_type);

    let text = result.message;
    if (result.action_needed) {
      text += `\n\nAction needed: ${result.action_needed}`;
    }

    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

    // Include QR code image if available (for clients that support images)
    if (result.qr_image_base64) {
      content.push({
        type: "image" as const,
        data: result.qr_image_base64,
        mimeType: "image/png",
      });
    }

    // Include Unicode text art QR code (works in ALL clients including Claude Desktop)
    if (result.qr_text_art) {
      text += "\n\nScan this QR code with any UPI app:\n\n";
      text += "```\n" + result.qr_text_art + "```";
    }

    // Include file path as fallback
    if (result.qr_file_path) {
      text += `\n\nQR code also saved to: ${result.qr_file_path}`;
    }

    content.push({ type: "text" as const, text });

    return { content };
  },
};
