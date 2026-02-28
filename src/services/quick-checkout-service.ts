import type { AppContext } from "../types.ts";
import { getCart as getCartFlow } from "../playwright/cart-flow.ts";
import {
  checkout as checkoutFlow,
  getPaymentMethods as getPaymentMethodsFlow,
  selectPaymentMethod as selectPaymentMethodFlow,
} from "../playwright/checkout-flow.ts";
import {
  getAddresses as getAddressesFlow,
  selectAddress as selectAddressFlow,
} from "../playwright/location-flow.ts";

export class QuickCheckoutService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async quickUpiCheckout(): Promise<{
    cart_summary: { item_count: number; total: number; items: string[] };
    address_selected: string | null;
    payment_methods: Array<{ name: string; type: string; available: boolean; details?: string }>;
    qr_image_base64?: string;
    qr_file_path?: string;
    qr_text_art?: string;
    steps_completed: string[];
    next_action: string;
    spending_warning?: string;
  }> {
    const page = await this.ctx.browserManager.ensurePage();
    const stepsCompleted: string[] = [];

    // Step 1: Get cart and validate it's not empty
    const cartData = await getCartFlow(page);
    if (cartData.item_count === 0) {
      throw new Error("Cart is empty. Add items before checking out.");
    }
    stepsCompleted.push("cart_opened");

    const cartSummary = {
      item_count: cartData.item_count,
      total: cartData.total,
      items: cartData.items.map(
        (i) => `${i.name} x${i.quantity} - ₹${i.total_price}`
      ),
    };

    // Step 2: Check spending guard
    const spendingCheck = this.ctx.spendingGuard.check(cartData.total);
    if (spendingCheck.exceeded_hard_limit) {
      throw new Error(
        spendingCheck.warning ??
          "Spending limit exceeded. Cannot proceed with checkout."
      );
    }
    const spendingWarning = spendingCheck.warning;

    // Step 3: Initiate checkout
    const checkoutResult = await checkoutFlow(page);
    stepsCompleted.push("checkout_initiated");

    // Step 4: Handle address selection if needed
    let addressSelected: string | null = null;
    if (checkoutResult.next_step === "select_address") {
      const addressResult = await getAddressesFlow(page);
      if (addressResult.addresses.length > 0) {
        const firstAddr = addressResult.addresses[0];
        await selectAddressFlow(page, 0);
        addressSelected = `${firstAddr.label}: ${firstAddr.address_line}`;
        stepsCompleted.push("address_selected");
      }
    }

    // Step 5: Get payment methods
    const paymentResult = await getPaymentMethodsFlow(page);
    stepsCompleted.push("payment_methods_loaded");

    // Step 6: Select UPI if available
    const upiMethod = paymentResult.methods.find(
      (m) => m.type === "upi" && m.available
    );

    let qrImageBase64: string | undefined;
    let qrFilePath: string | undefined;
    let qrTextArt: string | undefined;
    let nextAction: string;

    if (upiMethod) {
      const upiResult = await selectPaymentMethodFlow(page, "upi");
      stepsCompleted.push("upi_selected");

      qrImageBase64 = upiResult.qr_image_base64;
      qrFilePath = upiResult.qr_file_path;
      qrTextArt = upiResult.qr_text_art;

      nextAction =
        "Scan the QR code with your UPI app (Google Pay, PhonePe, Paytm) to complete payment.";
    } else {
      nextAction =
        "UPI not available. Select a payment method manually using select_payment_method.";
    }

    return {
      cart_summary: cartSummary,
      address_selected: addressSelected,
      payment_methods: paymentResult.methods,
      qr_image_base64: qrImageBase64,
      qr_file_path: qrFilePath,
      qr_text_art: qrTextArt,
      steps_completed: stepsCompleted,
      next_action: nextAction,
      spending_warning: spendingWarning,
    };
  }
}
