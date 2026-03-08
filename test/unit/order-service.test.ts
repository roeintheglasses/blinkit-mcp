import { describe, test, expect, vi, beforeEach } from "vitest";
import { OrderService } from "../../src/services/order-service.ts";
import type { AppContext, OrderSummary, OrderTracking } from "../../src/types.ts";
import * as cartFlow from "../../src/playwright/cart-flow.ts";
import * as checkoutFlow from "../../src/playwright/checkout-flow.ts";
import * as orderFlow from "../../src/playwright/order-flow.ts";

// Mock the playwright flows
vi.mock("../../src/playwright/cart-flow.ts");
vi.mock("../../src/playwright/checkout-flow.ts");
vi.mock("../../src/playwright/order-flow.ts");

describe("OrderService", () => {
  let mockContext: AppContext;
  let mockPage: any;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Mock page object
    mockPage = { url: "https://blinkit.com" };

    // Create mock AppContext
    mockContext = {
      browserManager: {
        ensurePage: vi.fn().mockResolvedValue(mockPage),
      },
      spendingGuard: {
        check: vi.fn((amount: number) => ({
          allowed: amount <= 2000,
          exceeded_hard_limit: amount > 2000,
          warning: amount > 500 ? `Cart total ₹${amount} exceeds warning threshold ₹500` : undefined,
        })),
      },
      sessionManager: {},
      httpClient: {},
      rateLimiter: {},
      logger: {},
      config: {},
    } as unknown as AppContext;
  });

  describe("checkout", () => {
    test("completes checkout successfully with low cart total", async () => {
      const service = new OrderService(mockContext);

      // Mock cart with low total
      vi.mocked(cartFlow.getCart).mockResolvedValue({
        items: [],
        subtotal: 200,
        delivery_fee: 0,
        handling_fee: 0,
        total: 200,
        item_count: 2,
      });

      // Mock successful checkout
      const mockCheckoutResult = {
        success: true,
        order_id: "ORD123",
        total: 200,
      };
      vi.mocked(checkoutFlow.checkout).mockResolvedValue(mockCheckoutResult);

      const result = await service.checkout();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(cartFlow.getCart).toHaveBeenCalledWith(mockPage);
      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(200);
      expect(checkoutFlow.checkout).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual(mockCheckoutResult);
      expect(result.spending_warning).toBeUndefined();
    });

    test("adds spending warning when cart total exceeds warning threshold", async () => {
      const service = new OrderService(mockContext);

      // Mock cart with high total (above warning threshold)
      vi.mocked(cartFlow.getCart).mockResolvedValue({
        items: [],
        subtotal: 750,
        delivery_fee: 0,
        handling_fee: 0,
        total: 750,
        item_count: 5,
      });

      // Mock successful checkout
      const mockCheckoutResult = {
        success: true,
        order_id: "ORD456",
        total: 750,
      };
      vi.mocked(checkoutFlow.checkout).mockResolvedValue(mockCheckoutResult);

      const result = await service.checkout();

      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(750);
      expect(checkoutFlow.checkout).toHaveBeenCalledWith(mockPage);
      expect(result.success).toBe(true);
      expect(result.spending_warning).toBeDefined();
      expect(result.spending_warning).toContain("750");
      expect(result.spending_warning).toContain("500");
    });

    test("blocks checkout when cart total exceeds hard limit", async () => {
      const service = new OrderService(mockContext);

      // Mock cart with total exceeding hard limit
      vi.mocked(cartFlow.getCart).mockResolvedValue({
        items: [],
        subtotal: 2500,
        delivery_fee: 0,
        handling_fee: 0,
        total: 2500,
        item_count: 10,
      });

      const result = await service.checkout();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(cartFlow.getCart).toHaveBeenCalledWith(mockPage);
      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(2500);
      // Checkout should be blocked, so checkoutFlow should NOT be called
      expect(checkoutFlow.checkout).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message).toContain("2500");
    });

    test("continues checkout even if cart check fails", async () => {
      const service = new OrderService(mockContext);

      // Mock cart call to throw error
      vi.mocked(cartFlow.getCart).mockRejectedValue(new Error("Cart fetch failed"));

      // Mock successful checkout
      const mockCheckoutResult = {
        success: true,
        order_id: "ORD789",
        total: 300,
      };
      vi.mocked(checkoutFlow.checkout).mockResolvedValue(mockCheckoutResult);

      const result = await service.checkout();

      expect(cartFlow.getCart).toHaveBeenCalledWith(mockPage);
      // Should still call checkout despite cart error
      expect(checkoutFlow.checkout).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual(mockCheckoutResult);
    });

    test("handles checkout at exactly hard limit (allowed)", async () => {
      const service = new OrderService(mockContext);

      // Mock cart at exactly hard limit
      vi.mocked(cartFlow.getCart).mockResolvedValue({
        items: [],
        subtotal: 2000,
        delivery_fee: 0,
        handling_fee: 0,
        total: 2000,
        item_count: 8,
      });

      const mockCheckoutResult = {
        success: true,
        order_id: "ORD999",
        total: 2000,
      };
      vi.mocked(checkoutFlow.checkout).mockResolvedValue(mockCheckoutResult);

      const result = await service.checkout();

      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(2000);
      expect(checkoutFlow.checkout).toHaveBeenCalledWith(mockPage);
      expect(result.success).toBe(true);
      // At 2000, it's allowed but should still warn (2000 > 500)
      expect(result.spending_warning).toBeDefined();
    });

    test("handles zero cart total", async () => {
      const service = new OrderService(mockContext);

      // Mock empty cart
      vi.mocked(cartFlow.getCart).mockResolvedValue({
        items: [],
        subtotal: 0,
        delivery_fee: 0,
        handling_fee: 0,
        total: 0,
        item_count: 0,
      });

      const mockCheckoutResult = {
        success: true,
        message: "Cart is empty",
      };
      vi.mocked(checkoutFlow.checkout).mockResolvedValue(mockCheckoutResult);

      const result = await service.checkout();

      expect(checkoutFlow.checkout).toHaveBeenCalledWith(mockPage);
      // With 0 total, spending check is skipped in the warning addition
      expect(result).toEqual(mockCheckoutResult);
    });
  });

  describe("getOrderHistory", () => {
    test("fetches order history with default limit", async () => {
      const service = new OrderService(mockContext);

      const mockOrders: OrderSummary[] = [
        {
          order_id: "ORD001",
          date: "2026-03-08",
          total: 450,
          item_count: 3,
          status: "delivered",
          items_summary: "Milk, Bread, Eggs",
        },
        {
          order_id: "ORD002",
          date: "2026-03-07",
          total: 320,
          item_count: 2,
          status: "delivered",
          items_summary: "Rice, Dal",
        },
      ];

      vi.mocked(orderFlow.getOrders).mockResolvedValue(mockOrders as any);

      const result = await service.getOrderHistory();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(orderFlow.getOrders).toHaveBeenCalledWith(mockPage, 5);
      expect(result).toEqual(mockOrders);
      expect(result).toHaveLength(2);
    });

    test("fetches order history with custom limit", async () => {
      const service = new OrderService(mockContext);

      const mockOrders: OrderSummary[] = [
        {
          order_id: "ORD001",
          date: "2026-03-08",
          total: 450,
          item_count: 3,
          status: "delivered",
          items_summary: "Milk, Bread, Eggs",
        },
      ];

      vi.mocked(orderFlow.getOrders).mockResolvedValue(mockOrders as any);

      const result = await service.getOrderHistory(1);

      expect(orderFlow.getOrders).toHaveBeenCalledWith(mockPage, 1);
      expect(result).toEqual(mockOrders);
    });

    test("handles empty order history", async () => {
      const service = new OrderService(mockContext);

      vi.mocked(orderFlow.getOrders).mockResolvedValue([]);

      const result = await service.getOrderHistory();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(orderFlow.getOrders).toHaveBeenCalledWith(mockPage, 5);
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    test("fetches order history with large limit", async () => {
      const service = new OrderService(mockContext);

      const mockOrders: OrderSummary[] = Array.from({ length: 10 }, (_, i) => ({
        order_id: `ORD${i + 1}`,
        date: "2026-03-08",
        total: 100 + i * 50,
        item_count: 1 + i,
        status: "delivered",
        items_summary: `Items ${i + 1}`,
      }));

      vi.mocked(orderFlow.getOrders).mockResolvedValue(mockOrders as any);

      const result = await service.getOrderHistory(10);

      expect(orderFlow.getOrders).toHaveBeenCalledWith(mockPage, 10);
      expect(result).toHaveLength(10);
    });
  });

  describe("trackOrder", () => {
    test("tracks order with order ID", async () => {
      const service = new OrderService(mockContext);

      const mockTracking: OrderTracking = {
        order_id: "ORD123",
        status: "out_for_delivery",
        eta_minutes: 15,
        delivery_partner: "John Doe",
        timeline: [
          { time: "10:00 AM", status: "Order placed" },
          { time: "10:30 AM", status: "Out for delivery" },
        ],
      };

      vi.mocked(orderFlow.trackOrder).mockResolvedValue(mockTracking as any);

      const result = await service.trackOrder("ORD123");

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(orderFlow.trackOrder).toHaveBeenCalledWith(mockPage, "ORD123");
      expect(result).toEqual(mockTracking);
      expect(result.order_id).toBe("ORD123");
      expect(result.status).toBe("out_for_delivery");
      expect(result.eta_minutes).toBe(15);
    });

    test("tracks order without order ID (latest order)", async () => {
      const service = new OrderService(mockContext);

      const mockTracking: OrderTracking = {
        order_id: "ORD456",
        status: "delivered",
        timeline: [
          { time: "09:00 AM", status: "Order placed" },
          { time: "09:45 AM", status: "Delivered" },
        ],
      };

      vi.mocked(orderFlow.trackOrder).mockResolvedValue(mockTracking as any);

      const result = await service.trackOrder();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(orderFlow.trackOrder).toHaveBeenCalledWith(mockPage, undefined);
      expect(result).toEqual(mockTracking);
    });

    test("tracks order with complete tracking info", async () => {
      const service = new OrderService(mockContext);

      const mockTracking: OrderTracking = {
        order_id: "ORD789",
        status: "processing",
        eta_minutes: 30,
        delivery_partner: "Jane Smith",
        timeline: [
          { time: "11:00 AM", status: "Order placed" },
          { time: "11:15 AM", status: "Processing" },
          { time: "11:30 AM", status: "Packed" },
        ],
      };

      vi.mocked(orderFlow.trackOrder).mockResolvedValue(mockTracking as any);

      const result = await service.trackOrder("ORD789");

      expect(orderFlow.trackOrder).toHaveBeenCalledWith(mockPage, "ORD789");
      expect(result.order_id).toBe("ORD789");
      expect(result.status).toBe("processing");
      expect(result.eta_minutes).toBe(30);
      expect(result.delivery_partner).toBe("Jane Smith");
      expect(result.timeline).toHaveLength(3);
    });

    test("tracks order with minimal tracking info", async () => {
      const service = new OrderService(mockContext);

      const mockTracking: OrderTracking = {
        order_id: "ORD999",
        status: "placed",
        timeline: [],
      };

      vi.mocked(orderFlow.trackOrder).mockResolvedValue(mockTracking as any);

      const result = await service.trackOrder("ORD999");

      expect(orderFlow.trackOrder).toHaveBeenCalledWith(mockPage, "ORD999");
      expect(result.order_id).toBe("ORD999");
      expect(result.status).toBe("placed");
      expect(result.eta_minutes).toBeUndefined();
      expect(result.delivery_partner).toBeUndefined();
      expect(result.timeline).toEqual([]);
    });
  });
});
