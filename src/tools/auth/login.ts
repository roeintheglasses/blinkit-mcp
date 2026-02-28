import { z } from "zod";
import type { AppContext } from "../../types.js";
import { AuthService } from "../../services/auth-service.js";

export const loginTool = {
  name: "login",
  description:
    "Initiate login to Blinkit with a phone number. This will send an OTP to the phone. Use enter_otp tool to complete login.",
  inputSchema: {
    phone_number: z
      .string()
      .regex(/^[6-9]\d{9}$/, "Must be a valid 10-digit Indian phone number"),
  },
  handler: async (input: { phone_number: string }, ctx: AppContext) => {
    const authService = new AuthService(ctx);
    const message = await authService.login(input.phone_number);

    return {
      content: [{ type: "text" as const, text: message }],
    };
  },
};
