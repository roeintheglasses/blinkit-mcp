import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { AuthService } from "../../services/auth-service.ts";

export const logoutTool = {
  name: "logout",
  description: "Log out from Blinkit. Clears saved session and auth tokens.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    const authService = new AuthService(ctx);
    await authService.logout();

    return {
      content: [{ type: "text" as const, text: "Successfully logged out." }],
    };
  },
};
