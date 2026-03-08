import type { AppContext } from "../../types.ts";
import { PaymentService } from "../../services/payment-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const getPaymentMethodsTool = {
  name: "get_payment_methods",
  description: "Get available payment methods (cards, UPI, netbanking, etc.) from the checkout payment page. Use after checkout to see how to pay.",
  inputSchema: {},
  handler: requireAuth(async (_input: {}, ctx: AppContext) => {
    const paymentService = new PaymentService(ctx);
    const result = await paymentService.getPaymentMethods();

    if (result.methods.length === 0) {
      return {
        content: [{ type: "text" as const, text: result.hint ?? "No payment methods found. Complete checkout first." }],
      };
    }

    const lines = result.methods.map((m, i) => {
      let line = `${i + 1}. ${m.name} (${m.type})`;
      if (!m.available) line += " [unavailable]";
      if (m.details) line += ` — ${m.details}`;
      return line;
    });

    return {
      content: [{ type: "text" as const, text: `Available payment methods:\n${lines.join("\n")}\n\nUse select_payment_method with the type (e.g. "card", "upi") to select one.` }],
    };
  }),
};
