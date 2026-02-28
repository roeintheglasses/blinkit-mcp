import type { AppContext, Address } from "../types.js";
import {
  setLocation as setLocationFlow,
  getAddresses as getAddressesFlow,
  selectAddress as selectAddressFlow,
} from "../playwright/location-flow.js";

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

    const page = await this.ctx.browserManager.ensurePage();
    await setLocationFlow(page, { addressQuery: address_query });

    return `Location set to: ${address_query}`;
  }

  async getSavedAddresses(): Promise<{ addresses: Address[]; hint?: string }> {
    const page = await this.ctx.browserManager.ensurePage();
    const data = await getAddressesFlow(page);

    return {
      addresses: data.addresses,
      ...(data.hint ? { hint: data.hint } : {}),
    };
  }

  async selectAddress(index: number): Promise<string> {
    const page = await this.ctx.browserManager.ensurePage();
    const data = await selectAddressFlow(page, index);

    return data.hint ?? `Address at index ${index} selected`;
  }
}
