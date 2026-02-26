import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { LocationService } from "../../services/location-service.ts";

export const setLocationTool = {
  name: "set_location",
  description: "Set delivery location by searching for an address or area name. Use this if auto-detected location is wrong.",
  inputSchema: {
    location_name: z.string().min(1, "Location search query is required").describe("Address or area to search for"),
  },
  handler: async (input: { location_name: string }, ctx: AppContext) => {
    const locationService = new LocationService(ctx);
    const result = await locationService.setLocation(input.location_name);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
