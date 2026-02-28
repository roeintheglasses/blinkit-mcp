import { z } from "zod";
import type { AppContext } from "../../types.js";
import { AuthService } from "../../services/auth-service.js";

export const enterOtpTool = {
  name: "enter_otp",
  description: "Submit the OTP received via SMS to complete Blinkit login",
  inputSchema: {
    otp: z.string().regex(/^\d{4}$/, "OTP must be exactly 4 digits"),
  },
  handler: async (input: { otp: string }, ctx: AppContext) => {
    const authService = new AuthService(ctx);
    const message = await authService.enterOtp(input.otp);

    return {
      content: [{ type: "text" as const, text: message }],
    };
  },
};
