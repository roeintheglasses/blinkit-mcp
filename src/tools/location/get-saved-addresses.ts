import type { AppContext } from "../../types.ts";
import { LocationService } from "../../services/location-service.ts";
import { requireAuth } from "../../utils/auth-wrapper.ts";

export const getSavedAddressesTool = {
  name: "get_saved_addresses",
  description: "List user's saved delivery addresses on Blinkit. Requires authentication.",
  inputSchema: {},
  handler: requireAuth(async (_input: {}, ctx: AppContext) => {
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
  }),
};
