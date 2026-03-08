import { describe, test, expect, vi, beforeEach } from "vitest";
import { CartService } from "../../src/services/cart-service.ts";
import type { AppContext } from "../../src/types.ts";
import type { Page } from "playwright";
import type { Logger } from "../../src/core/logger.ts";
import type { BrowserManager } from "../../src/core/browser-manager.ts";
import type { SpendingGuard } from "../../src/services/spending-guard.ts";

// Mock the cart-flow module
vi.mock("../../src/playwright/cart-flow.ts", () => ({
  getCart: vi.fn(),
  addToCart: vi.fn(),
  updateCartItem: vi.fn(),
  removeFromCart: vi.fn(),
  clearCart: vi.fn(),
}));

import {
  getCart as getCartFlow,
  addToCart as addToCartFlow,
  updateCartItem as updateCartItemFlow,
  removeFromCart as removeFromCartFlow,
  clearCart as clearCartFlow,
} from "../../src/playwright/cart-flow.ts";

describe("CartService", () => {
  let mockContext: AppContext;
  let mockPage: Page;
  let cartService: CartService;

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
      } as unknown as Logger,
      browserManager: {
        ensurePage: vi.fn(async () => mockPage),
      } as unknown as BrowserManager,
      spendingGuard: {
        check: vi.fn((amount: number) => ({
          allowed: true,
          exceeded_hard_limit: false,
          warning: undefined,
        })),
      } as unknown as SpendingGuard,
      config: {} as any,
      httpClient: {} as any,
      sessionManager: {} as any,
      rateLimiter: {} as any,
    };

    cartService = new CartService(mockContext);
  });

  describe("getCart", () => {
    test("returns cart with all fields", async () => {
      const mockCartData = {
        items: [
          {
            name: "Milk",
            variant: "1L",
            unit_price: 60,
            quantity: 2,
            total_price: 120,
          },
        ],
        subtotal: 120,
        delivery_fee: 20,
        handling_fee: 5,
        total: 145,
        item_count: 1,
      };

      vi.mocked(getCartFlow).mockResolvedValue(mockCartData);
      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: true,
        exceeded_hard_limit: false,
      });

      const result = await cartService.getCart();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(getCartFlow).toHaveBeenCalledWith(mockPage);
      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(145);
      expect(result).toEqual({
        items: mockCartData.items,
        subtotal: 120,
        delivery_fee: 20,
        handling_fee: 5,
        total: 145,
        item_count: 1,
        warning: undefined,
      });
    });

    test("includes spending warning when spending limit exceeded", async () => {
      const mockCartData = {
        items: [],
        subtotal: 600,
        delivery_fee: 20,
        handling_fee: 5,
        total: 625,
        item_count: 0,
      };

      vi.mocked(getCartFlow).mockResolvedValue(mockCartData);
      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: true,
        exceeded_hard_limit: false,
        warning: "Cart total ₹625 exceeds warning threshold of ₹500",
      });

      const result = await cartService.getCart();

      expect(result.spending_warning).toBe("Cart total ₹625 exceeds warning threshold of ₹500");
      expect(result.total).toBe(625);
    });

    test("includes warning from cart flow", async () => {
      const mockCartData = {
        items: [],
        subtotal: 0,
        delivery_fee: 0,
        handling_fee: 0,
        total: 0,
        item_count: 0,
        warning: "Cart is empty",
      };

      vi.mocked(getCartFlow).mockResolvedValue(mockCartData);

      const result = await cartService.getCart();

      expect(result.warning).toBe("Cart is empty");
    });

    test("handles empty cart", async () => {
      const mockCartData = {
        items: [],
        subtotal: 0,
        delivery_fee: 0,
        handling_fee: 0,
        total: 0,
        item_count: 0,
      };

      vi.mocked(getCartFlow).mockResolvedValue(mockCartData);

      const result = await cartService.getCart();

      expect(result.item_count).toBe(0);
      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe("addToCart", () => {
    test("successfully adds item to cart", async () => {
      vi.mocked(addToCartFlow).mockResolvedValue({
        success: true,
        cart_total: 150,
        item_name: "Bread",
        quantity_added: 2,
      });

      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: true,
        exceeded_hard_limit: false,
      });

      const result = await cartService.addToCart("product-123", 2);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(addToCartFlow).toHaveBeenCalledWith(mockPage, "product-123", 2);
      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(150);
      expect(result).toEqual({
        success: true,
        cart_total: 150,
        item_name: "Bread",
        quantity_added: 2,
        spending_warning: undefined,
      });
    });

    test("includes spending warning when limit exceeded", async () => {
      vi.mocked(addToCartFlow).mockResolvedValue({
        success: true,
        cart_total: 2500,
        item_name: "Expensive Item",
        quantity_added: 1,
      });

      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: false,
        exceeded_hard_limit: true,
        warning: "Cart total ₹2500 exceeds hard limit of ₹2000",
      });

      const result = await cartService.addToCart("product-456", 1);

      expect(result.spending_warning).toBe("Cart total ₹2500 exceeds hard limit of ₹2000");
      expect(result.success).toBe(true);
    });

    test("uses default quantity of 1 when not specified", async () => {
      vi.mocked(addToCartFlow).mockResolvedValue({
        success: true,
        cart_total: 50,
        item_name: "Item",
        quantity_added: 1,
      });

      await cartService.addToCart("product-789");

      expect(addToCartFlow).toHaveBeenCalledWith(mockPage, "product-789", 1);
    });

    test("returns all fields from flow result", async () => {
      vi.mocked(addToCartFlow).mockResolvedValue({
        success: true,
        cart_total: 300,
        item_name: "Product Name",
        quantity_added: 5,
      });

      const result = await cartService.addToCart("product-999", 5);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("cart_total");
      expect(result).toHaveProperty("item_name");
      expect(result).toHaveProperty("quantity_added");
      expect(result.quantity_added).toBe(5);
    });
  });

  describe("updateCartItem", () => {
    test("successfully updates cart item quantity", async () => {
      vi.mocked(updateCartItemFlow).mockResolvedValue({
        success: true,
        new_quantity: 3,
        cart_total: 180,
      });

      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: true,
        exceeded_hard_limit: false,
      });

      const result = await cartService.updateCartItem("product-123", 3);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(updateCartItemFlow).toHaveBeenCalledWith(mockPage, "product-123", 3);
      expect(mockContext.spendingGuard.check).toHaveBeenCalledWith(180);
      expect(result).toEqual({
        success: true,
        new_quantity: 3,
        cart_total: 180,
        spending_warning: undefined,
      });
    });

    test("includes spending warning when updating quantity", async () => {
      vi.mocked(updateCartItemFlow).mockResolvedValue({
        success: true,
        new_quantity: 10,
        cart_total: 1500,
      });

      vi.mocked(mockContext.spendingGuard.check).mockReturnValue({
        allowed: true,
        exceeded_hard_limit: false,
        warning: "Cart total ₹1500 exceeds warning threshold",
      });

      const result = await cartService.updateCartItem("product-456", 10);

      expect(result.spending_warning).toBe("Cart total ₹1500 exceeds warning threshold");
    });

    test("handles quantity update to zero", async () => {
      vi.mocked(updateCartItemFlow).mockResolvedValue({
        success: true,
        new_quantity: 0,
        cart_total: 50,
      });

      const result = await cartService.updateCartItem("product-789", 0);

      expect(updateCartItemFlow).toHaveBeenCalledWith(mockPage, "product-789", 0);
      expect(result.new_quantity).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe("removeFromCart", () => {
    test("successfully removes item from cart", async () => {
      vi.mocked(removeFromCartFlow).mockResolvedValue({
        success: true,
        cart_total: 100,
      });

      const result = await cartService.removeFromCart("product-123", 1);

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(removeFromCartFlow).toHaveBeenCalledWith(mockPage, "product-123", 1);
      expect(result).toEqual({
        success: true,
        removed_item: "product-123",
        new_cart_total: 100,
      });
    });

    test("uses default quantity of 1 when not specified", async () => {
      vi.mocked(removeFromCartFlow).mockResolvedValue({
        success: true,
        cart_total: 75,
      });

      await cartService.removeFromCart("product-456");

      expect(removeFromCartFlow).toHaveBeenCalledWith(mockPage, "product-456", 1);
    });

    test("removes multiple quantities", async () => {
      vi.mocked(removeFromCartFlow).mockResolvedValue({
        success: true,
        cart_total: 200,
      });

      const result = await cartService.removeFromCart("product-789", 3);

      expect(removeFromCartFlow).toHaveBeenCalledWith(mockPage, "product-789", 3);
      expect(result.removed_item).toBe("product-789");
    });

    test("returns updated cart total", async () => {
      vi.mocked(removeFromCartFlow).mockResolvedValue({
        success: true,
        cart_total: 0,
      });

      const result = await cartService.removeFromCart("product-999", 1);

      expect(result.new_cart_total).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe("clearCart", () => {
    test("successfully clears entire cart", async () => {
      vi.mocked(clearCartFlow).mockResolvedValue({
        success: true,
        items_cleared: 5,
      });

      const result = await cartService.clearCart();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(clearCartFlow).toHaveBeenCalledWith(mockPage);
      expect(result).toEqual({
        success: true,
        items_removed_count: 5,
      });
    });

    test("handles empty cart clear", async () => {
      vi.mocked(clearCartFlow).mockResolvedValue({
        success: true,
        items_cleared: 0,
      });

      const result = await cartService.clearCart();

      expect(result.items_removed_count).toBe(0);
      expect(result.success).toBe(true);
    });

    test("returns correct count of removed items", async () => {
      vi.mocked(clearCartFlow).mockResolvedValue({
        success: true,
        items_cleared: 12,
      });

      const result = await cartService.clearCart();

      expect(result.items_removed_count).toBe(12);
    });
  });
});
