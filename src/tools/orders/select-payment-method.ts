import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const selectPaymentMethodTool = {
  name: "select_payment_method",
  description: "Select a payment method on the checkout page. Types: 'card' (credit/debit), 'upi' (QR code), 'netbanking', 'wallets', 'pay_later'. For UPI, this generates a QR code image for the user to scan. For card, it shows the saved card with CVV input.",
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

    // Include QR code image if available (for UPI payments)
    if (result.qr_image_base64) {
      content.push({
        type: "image" as const,
        data: result.qr_image_base64,
        mimeType: "image/png",
      });
      text += "\n\nQR code image is attached above. Share it with the user to scan.";
    }

    content.push({ type: "text" as const, text });

    return { content };
  },
};
