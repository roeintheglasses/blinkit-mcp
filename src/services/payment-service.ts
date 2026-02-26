import type { AppContext } from "../types.ts";

export class PaymentService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getUpiIds(): Promise<string[]> {
    const result = await this.ctx.browserManager.sendCommand("getUpiIds", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to get UPI IDs");
    }
    return (result.data as { upi_ids: string[] }).upi_ids;
  }

  async selectUpiId(upiId: string): Promise<void> {
    const result = await this.ctx.browserManager.sendCommand("selectUpiId", { upiId });
    if (!result.success) {
      throw new Error(result.error ?? "Failed to select UPI ID");
    }
  }

  async payNow(): Promise<string> {
    const result = await this.ctx.browserManager.sendCommand("payNow", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to click Pay Now");
    }
    return (result.data as { message: string }).message;
  }
}
