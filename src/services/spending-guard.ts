import type { BlinkitConfig } from "../config/schema.ts";
import type { SpendingCheckResult } from "../types.ts";

export class SpendingGuard {
  private warnThreshold: number;
  private maxOrderAmount: number;

  constructor(config: BlinkitConfig) {
    this.warnThreshold = config.warn_threshold;
    this.maxOrderAmount = config.max_order_amount;
  }

  check(cartTotal: number): SpendingCheckResult {
    if (cartTotal > this.maxOrderAmount) {
      return {
        allowed: false,
        warning: `Cart total ₹${cartTotal} exceeds the hard limit of ₹${this.maxOrderAmount}. Checkout is blocked. Remove items to proceed.`,
        exceeded_hard_limit: true,
      };
    }

    if (cartTotal > this.warnThreshold) {
      return {
        allowed: true,
        warning: `Cart total ₹${cartTotal} exceeds the warning threshold of ₹${this.warnThreshold}. Please review before proceeding.`,
        exceeded_hard_limit: false,
      };
    }

    return { allowed: true, exceeded_hard_limit: false };
  }
}
