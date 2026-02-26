import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { LocationService } from "../../services/location-service.ts";

export const selectAddressTool = {
  name: "select_address",
  description: "Select a delivery address during checkout by index. Automatically navigates through intermediate steps (tip selection, proceed to pay) toward the payment page. Use get_saved_addresses to see available addresses.",
  inputSchema: {
    address_index: z.number().int().min(0),
  },
  handler: async (input: { address_index: number }, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool with your phone number, then enter_otp to authenticate." }],
        isError: true,
      };
    }

    const locationService = new LocationService(ctx);
    const message = await locationService.selectAddress(input.address_index);

    return {
      content: [{ type: "text" as const, text: message }],
    };
  },
};
