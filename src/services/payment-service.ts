import type { AppContext } from "../types.ts";
import {
  getUpiIds as getUpiIdsFlow,
  selectUpiId as selectUpiIdFlow,
  payNow as payNowFlow,
} from "../playwright/checkout-flow.ts";

export class PaymentService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getUpiIds(): Promise<string[]> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await getUpiIdsFlow(page);
    return result.upi_ids;
  }

  async selectUpiId(upiId: string): Promise<void> {
    const page = await this.ctx.browserManager.ensurePage();
    await selectUpiIdFlow(page, upiId);
  }

  async payNow(): Promise<string> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await payNowFlow(page);
    return result.message;
  }
}
