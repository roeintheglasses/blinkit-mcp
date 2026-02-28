import type { AppContext } from "../types.ts";
import {
  getPaymentMethods as getPaymentMethodsFlow,
  selectPaymentMethod as selectPaymentMethodFlow,
  payNow as payNowFlow,
} from "../playwright/checkout-flow.ts";

export class PaymentService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async getPaymentMethods(): Promise<{
    methods: Array<{
      name: string;
      type: string;
      available: boolean;
      details?: string;
    }>;
    hint?: string;
  }> {
    const page = await this.ctx.browserManager.ensurePage();
    return getPaymentMethodsFlow(page);
  }

  async selectPaymentMethod(methodType: string): Promise<{
    selected: boolean;
    message: string;
    action_needed?: string;
    qr_image_base64?: string;
  }> {
    const page = await this.ctx.browserManager.ensurePage();
    return selectPaymentMethodFlow(page, methodType);
  }

  async payNow(): Promise<string> {
    const page = await this.ctx.browserManager.ensurePage();
    const result = await payNowFlow(page);
    return result.message;
  }
}
