import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const payNowTool = {
  name: "pay_now",
  description: "Click the 'Pay Now' button on the checkout page to complete the transaction. For card payment, CVV must be entered first. For UPI, the QR code must be scanned first.",
  inputSchema: {},
  handler: requireAuth(async (_input: {}, ctx: AppContext) => {
    const paymentService = new PaymentService(ctx);
    const message = await paymentService.payNow();

    return {
      content: [{ type: "text" as const, text: message }],
    };
  }),
};
