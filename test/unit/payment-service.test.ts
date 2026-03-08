import { describe, test, expect, vi, beforeEach } from "vitest";
import { PaymentService } from "../../src/services/payment-service.ts";
import type { AppContext } from "../../src/types.ts";
import type { Page } from "playwright";

// Mock the payment-flow module
vi.mock("../../src/playwright/payment-flow.ts", () => ({
  getPaymentMethods: vi.fn(),
  selectPaymentMethod: vi.fn(),
  payNow: vi.fn(),
}));

import {
  getPaymentMethods as getPaymentMethodsFlow,
  selectPaymentMethod as selectPaymentMethodFlow,
  payNow as payNowFlow,
} from "../../src/playwright/payment-flow.ts";

describe("PaymentService", () => {
  let mockContext: AppContext;
  let mockPage: Page;
  let paymentService: PaymentService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock page
    mockPage = {
      isClosed: vi.fn(() => false),
    } as unknown as Page;

    // Create mock AppContext
    mockContext = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      browserManager: {
        ensurePage: vi.fn(async () => mockPage),
        isRunning: vi.fn(() => true),
        close: vi.fn(async () => {}),
      },
      sessionManager: {
        isAuthenticated: vi.fn(() => true),
        getPhone: vi.fn(() => "1234567890"),
      },
      config: {} as any,
      httpClient: {} as any,
      rateLimiter: {} as any,
      spendingGuard: {} as any,
    };

    paymentService = new PaymentService(mockContext);
  });

  describe("getPaymentMethods", () => {
    test("returns payment methods from flow", async () => {
      const mockMethods = {
        methods: [
          { name: "UPI", type: "upi", available: true, details: "QR code based" },
          { name: "Credit/Debit Cards", type: "card", available: true },
          { name: "Cash on Delivery", type: "cod", available: false, details: "Not available" },
        ],
      };

      vi.mocked(getPaymentMethodsFlow).mockResolvedValue(mockMethods);

      const result = await paymentService.getPaymentMethods();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(getPaymentMethodsFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual(mockMethods);
      expect(result.methods).toHaveLength(3);
    });

    test("returns empty methods with hint when widget not found", async () => {
      const mockResponse = {
        methods: [],
        hint: "Payment widget not found. Make sure checkout and address selection are complete.",
      };

      vi.mocked(getPaymentMethodsFlow).mockResolvedValue(mockResponse);

      const result = await paymentService.getPaymentMethods();

      expect(result.methods).toEqual([]);
      expect(result.hint).toBe("Payment widget not found. Make sure checkout and address selection are complete.");
    });

    test("handles payment methods with details", async () => {
      const mockMethods = {
        methods: [
          { name: "UPI", type: "upi", available: true, details: "QR code based — scan with any UPI app" },
          { name: "Credit/Debit Cards", type: "card", available: true, details: "Saved card ending in 1234" },
        ],
      };

      vi.mocked(getPaymentMethodsFlow).mockResolvedValue(mockMethods);

      const result = await paymentService.getPaymentMethods();

      expect(result.methods[0].details).toBe("QR code based — scan with any UPI app");
      expect(result.methods[1].details).toBe("Saved card ending in 1234");
    });

    test("handles all available payment method types", async () => {
      const mockMethods = {
        methods: [
          { name: "Wallets", type: "wallets", available: true },
          { name: "Credit/Debit Cards", type: "card", available: true },
          { name: "Netbanking", type: "netbanking", available: true },
          { name: "UPI", type: "upi", available: true },
          { name: "Cash on Delivery", type: "cod", available: true },
          { name: "Pay Later", type: "pay_later", available: true },
        ],
      };

      vi.mocked(getPaymentMethodsFlow).mockResolvedValue(mockMethods);

      const result = await paymentService.getPaymentMethods();

      expect(result.methods).toHaveLength(6);
      expect(result.methods.map(m => m.type)).toEqual([
        "wallets",
        "card",
        "netbanking",
        "upi",
        "cod",
        "pay_later",
      ]);
    });

    test("ensures page is ready before calling flow", async () => {
      const mockMethods = { methods: [] };
      vi.mocked(getPaymentMethodsFlow).mockResolvedValue(mockMethods);

      await paymentService.getPaymentMethods();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(getPaymentMethodsFlow)
      );
    });
  });

  describe("selectPaymentMethod", () => {
    test("successfully selects UPI with QR code", async () => {
      const mockResult = {
        selected: true,
        message: "UPI selected. QR code generated.",
        action_needed: "Scan the QR code with your UPI app to complete payment.",
        qr_image_base64: "base64encodedstring",
        qr_file_path: "/home/user/.blinkit-mcp/upi-qr-code.png",
        qr_text_art: "█▀█\n█▄█",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("upi");

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "upi");
      expect(result.selected).toBe(true);
      expect(result.qr_image_base64).toBe("base64encodedstring");
      expect(result.qr_file_path).toBe("/home/user/.blinkit-mcp/upi-qr-code.png");
      expect(result.qr_text_art).toBe("█▀█\n█▄█");
    });

    test("successfully selects card payment", async () => {
      const mockResult = {
        selected: true,
        message: "Card payment selected. Saved card is available.",
        action_needed: "Enter the CVV for your saved card, then use pay_now to complete payment.",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("card");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "card");
      expect(result.selected).toBe(true);
      expect(result.message).toContain("Card payment selected");
      expect(result.action_needed).toContain("CVV");
    });

    test("successfully selects cash on delivery", async () => {
      const mockResult = {
        selected: true,
        message: "Cash section expanded.",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("cod");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "cod");
      expect(result.selected).toBe(true);
      expect(result.message).toBe("Cash section expanded.");
    });

    test("handles netbanking selection", async () => {
      const mockResult = {
        selected: true,
        message: "Netbanking section expanded.",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("netbanking");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "netbanking");
      expect(result.selected).toBe(true);
    });

    test("handles wallets selection", async () => {
      const mockResult = {
        selected: true,
        message: "Wallets section expanded.",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("wallets");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "wallets");
      expect(result.selected).toBe(true);
    });

    test("handles pay later selection", async () => {
      const mockResult = {
        selected: true,
        message: "Pay Later section expanded.",
      };

      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      const result = await paymentService.selectPaymentMethod("pay_later");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "pay_later");
      expect(result.selected).toBe(true);
    });

    test("passes method type correctly to flow", async () => {
      const mockResult = { selected: true, message: "Selected" };
      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      await paymentService.selectPaymentMethod("upi");

      expect(selectPaymentMethodFlow).toHaveBeenCalledWith(mockPage, "upi");
    });

    test("ensures page is ready before selecting method", async () => {
      const mockResult = { selected: true, message: "Selected" };
      vi.mocked(selectPaymentMethodFlow).mockResolvedValue(mockResult);

      await paymentService.selectPaymentMethod("card");

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(selectPaymentMethodFlow)
      );
    });
  });

  describe("payNow", () => {
    test("successfully initiates payment", async () => {
      const mockResult = {
        message: "Pay Now clicked. Complete payment on your device (approve UPI request or enter OTP for card).",
      };

      vi.mocked(payNowFlow).mockResolvedValue(mockResult);

      const result = await paymentService.payNow();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(payNowFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toBe(
        "Pay Now clicked. Complete payment on your device (approve UPI request or enter OTP for card)."
      );
    });

    test("returns message for UPI payment completion", async () => {
      const mockResult = {
        message: "Pay Now clicked. Complete payment on your device.",
      };

      vi.mocked(payNowFlow).mockResolvedValue(mockResult);

      const result = await paymentService.payNow();

      expect(result).toBe("Pay Now clicked. Complete payment on your device.");
    });

    test("returns message for Zpayments button", async () => {
      const mockResult = {
        message: "Pay Now clicked. Complete payment on your device.",
      };

      vi.mocked(payNowFlow).mockResolvedValue(mockResult);

      const result = await paymentService.payNow();

      expect(payNowFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toContain("Pay Now clicked");
    });

    test("ensures page is ready before clicking pay now", async () => {
      const mockResult = { message: "Payment initiated" };
      vi.mocked(payNowFlow).mockResolvedValue(mockResult);

      await paymentService.payNow();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalledBefore(
        vi.mocked(payNowFlow)
      );
    });

    test("extracts message from flow result", async () => {
      const mockResult = {
        message: "Custom payment message",
      };

      vi.mocked(payNowFlow).mockResolvedValue(mockResult);

      const result = await paymentService.payNow();

      expect(result).toBe("Custom payment message");
    });
  });
});
