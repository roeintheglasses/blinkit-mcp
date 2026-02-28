import { z } from "zod";
import type { AppContext } from "../../types.js";
import { AuthService } from "../../services/auth-service.js";

export const checkLoginStatusTool = {
  name: "check_login_status",
  description: "Check if the current session is authenticated with Blinkit",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    const authService = new AuthService(ctx);
    const status = await authService.checkLoginStatus();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  },
};
