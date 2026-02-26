import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const payNowTool = {
  name: "pay_now",
  description: "Click the 'Pay Now' button to complete the transaction. Make sure you have selected a payment method first.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
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
