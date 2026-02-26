import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";

export const getUpiIdsTool = {
  name: "get_upi_ids",
  description: "Get available UPI IDs from the payment page. Automatically navigates past intermediate screens (tip selection, etc.) if needed. Use after checkout and address selection.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const paymentService = new PaymentService(ctx);
    const upiIds = await paymentService.getUpiIds();

    if (upiIds.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No UPI IDs found. Make sure you have completed checkout and selected a delivery address to reach the payment page." }],
      };
    }

    return {
      content: [{ type: "text" as const, text: `Available UPI IDs:\n${upiIds.map((id, i) => `  ${i + 1}. ${id}`).join("\n")}` }],
    };
  },
};
