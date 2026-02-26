import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const selectUpiIdTool = {
  name: "select_upi_id",
  description: "Select a specific UPI ID (e.g. 'user@ybl') or enter a new one for payment.",
  inputSchema: {
    upi_id: z.string().min(1, "UPI ID is required").describe("UPI VPA to select or enter (e.g. 'user@ybl')"),
  },
  handler: async (input: { upi_id: string }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const paymentService = new PaymentService(ctx);
    await paymentService.selectUpiId(input.upi_id);

    return {
      content: [{ type: "text" as const, text: `Selected UPI ID: ${input.upi_id}` }],
    };
  },
};
