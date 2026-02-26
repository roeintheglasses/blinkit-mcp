import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { LocationService } from "../../services/location-service.ts";

export const getSavedAddressesTool = {
  name: "get_saved_addresses",
  description: "List user's saved delivery addresses on Blinkit. Requires authentication.",
  inputSchema: {},
  handler: async (_input: {}, ctx: AppContext) => {
    if (!ctx.sessionManager.isAuthenticated()) {
      return {
        content: [{ type: "text" as const, text: "Not logged in. Use the login tool first." }],
        isError: true,
      };
    }

    const locationService = new LocationService(ctx);
    const addresses = await locationService.getSavedAddresses();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(addresses, null, 2),
        },
      ],
    };
  },
};
