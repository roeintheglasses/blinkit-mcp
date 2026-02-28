import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const payNowTool = {
  name: "pay_now",
  description: "Click the 'Pay Now' button on the checkout page to complete the transaction. For card payment, CVV must be entered first. For UPI, the QR code must be scanned first.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const paymentService = new PaymentService(ctx);
    const message = await paymentService.payNow();

    return {
      content: [{ type: "text" as const, text: message }],
    };
  },
};
