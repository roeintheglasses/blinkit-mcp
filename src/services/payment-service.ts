import type { AppContext } from "../types.ts";

export class PaymentService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getUpiIds(): Promise<string[]> {
    const result = await this.ctx.browserManager.sendCommand("getUpiIds", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to retrieve UPI IDs. Make sure you are on the payment page — run checkout and select an address first.");
    }
    return (result.data as { upi_ids: string[] }).upi_ids;
  }

  async selectUpiId(upiId: string): Promise<void> {
    const result = await this.ctx.browserManager.sendCommand("selectUpiId", { upiId });
    if (!result.success) {
      throw new Error(result.error ?? `Failed to select UPI ID '${upiId}'. The UPI ID may be invalid — use get_upi_ids to see available options.`);
    }
  }

  async payNow(): Promise<string> {
    const result = await this.ctx.browserManager.sendCommand("payNow", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to initiate payment. Make sure a UPI ID is selected and the payment page is loaded.");
    }
    return (result.data as { message: string }).message;
  }
}
