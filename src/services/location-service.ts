import type { AppContext, Address } from "../types.ts";

export class LocationService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async setLocation(params: {
    address_query: string;
  }): Promise<string> {
    const { address_query } = params;

    if (!address_query) {
      throw new Error("Provide an address_query to search for a location");
    }

    const result = await this.ctx.browserManager.sendCommand("setLocation", {
      addressQuery: address_query,
    });

    if (!result.success) {
      throw new Error(result.error ?? `Failed to set location to '${address_query}'. The address may not be recognized — try a more specific or different address.`);
    }

    return `Location set to: ${address_query}`;
  }

  async getSavedAddresses(): Promise<{ addresses: Address[]; hint?: string }> {
    const result = await this.ctx.browserManager.sendCommand("getAddresses", {});

    if (!result.success) {
      throw new Error(result.error ?? "Failed to retrieve saved addresses. Your session may have expired — try checking login status.");
    }

    const data = result.data as { addresses: Address[]; hint?: string };
    return {
      addresses: data.addresses,
      ...(data.hint ? { hint: data.hint } : {}),
    };
  }

  async selectAddress(index: number): Promise<string> {
    const result = await this.ctx.browserManager.sendCommand("selectAddress", {
      index,
    });

    if (!result.success) {
      throw new Error(result.error ?? `Failed to select address at index ${index}. Use get_saved_addresses to see valid address indices.`);
    }

    const data = result.data as {
      selected: boolean;
      payment_ready?: boolean;
      hint?: string;
      skipped_steps?: string[];
    };

    return data.hint ?? `Address at index ${index} selected`;
  }
}
