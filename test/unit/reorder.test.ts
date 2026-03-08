import { describe, test, expect, vi, beforeEach } from "vitest";
import { ReorderService } from "../../src/services/reorder-service.ts";
import type { AppContext, OrderDetails, Product } from "../../src/types.ts";

// Mock the dependencies
vi.mock("../../src/playwright/order-flow.ts", () => ({
  getOrders: vi.fn(),
  getOrderDetails: vi.fn(),
}));

vi.mock("../../src/services/product-service.ts", () => ({
  ProductService: vi.fn(),
}));

vi.mock("../../src/services/cart-service.ts", () => ({
  CartService: vi.fn(),
}));

import {
  getOrders as getOrdersFlow,
  getOrderDetails as getOrderDetailsFlow,
} from "../../src/playwright/order-flow.ts";
import { ProductService } from "../../src/services/product-service.ts";
import { CartService } from "../../src/services/cart-service.ts";

describe("ReorderService", () => {
  let mockCtx: AppContext;
  let mockPage: any;
  let mockProductService: any;
  let mockCartService: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock page
    mockPage = {};

    // Create mock context
    mockCtx = {
      browserManager: {
        ensurePage: vi.fn().mockResolvedValue(mockPage),
      },
      logger: {
        debug: vi.fn(),
      },
    } as unknown as AppContext;

    // Create mock product service
    mockProductService = {
      search: vi.fn(),
    };
    vi.mocked(ProductService).mockImplementation(() => mockProductService);

    // Create mock cart service
    mockCartService = {
      addToCart: vi.fn(),
    };
    vi.mocked(CartService).mockImplementation(() => mockCartService);
  });

  describe("reorder last order", () => {
    test("successfully reorders last order with all items available", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 2,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 2,
            original_price: 60,
          },
          {
            product_id: "PROD2",
            name: "Bread",
            quantity: 1,
            original_price: 40,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD1",
              name: "Milk 1L",
              price: 60,
              in_stock: true,
            } as Product,
          ],
        })
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD2",
              name: "Bread",
              price: 40,
              in_stock: true,
            } as Product,
          ],
        });

      mockCartService.addToCart
        .mockResolvedValueOnce({
          success: true,
          quantity_added: 2,
          cart_total: 120,
        })
        .mockResolvedValueOnce({
          success: true,
          quantity_added: 1,
          cart_total: 160,
        });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("last");

      expect(result.success).toBe(true);
      expect(result.items_added).toHaveLength(2);
      expect(result.items_added[0]).toEqual({
        name: "Milk 1L",
        quantity: 2,
        price: 60,
        price_changed: false,
        old_price: undefined,
      });
      expect(result.items_added[1]).toEqual({
        name: "Bread",
        quantity: 1,
        price: 40,
        price_changed: false,
        old_price: undefined,
      });
      expect(result.unavailable_items).toHaveLength(0);
      expect(result.price_changes).toHaveLength(0);
      expect(result.cart_total).toBe(160);
    });

    test("detects price changes when reordering", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 100,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1",
            name: "Milk 1L",
            price: 70,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 70,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(true);
      expect(result.items_added[0].price_changed).toBe(true);
      expect(result.items_added[0].old_price).toBe(60);
      expect(result.price_changes).toHaveLength(1);
      expect(result.price_changes[0]).toEqual({
        name: "Milk 1L",
        old_price: 60,
        new_price: 70,
      });
    });

    test("handles spending warning from cart service", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Expensive Item",
            quantity: 1,
            original_price: 1500,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1",
            name: "Expensive Item",
            price: 1500,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 1500,
        spending_warning: "Cart total ₹1,500 exceeds warning threshold",
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(true);
      expect(result.spending_warning).toBe(
        "Cart total ₹1,500 exceeds warning threshold"
      );
    });

    test("throws error when no orders found", async () => {
      vi.mocked(getOrdersFlow).mockResolvedValue([]);

      const service = new ReorderService(mockCtx);

      await expect(service.reorder("last")).rejects.toThrow(
        "No orders found in order history"
      );
    });
  });

  describe("reorder specific order", () => {
    test("successfully reorders order by ID from recent orders", async () => {
      const mockOrders: OrderDetails[] = [
        {
          order_id: "ORDER123",
          date: "2026-03-08",
          total: 500,
          item_count: 1,
          status: "delivered",
          items: [
            {
              product_id: "PROD1",
              name: "Milk 1L",
              quantity: 1,
              original_price: 60,
            },
          ],
        },
        {
          order_id: "ORDER456",
          date: "2026-03-07",
          total: 300,
          item_count: 1,
          status: "delivered",
          items: [
            {
              product_id: "PROD2",
              name: "Bread",
              quantity: 1,
              original_price: 40,
            },
          ],
        },
      ];

      vi.mocked(getOrdersFlow).mockResolvedValue(mockOrders);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD2",
            name: "Bread",
            price: 40,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 40,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("ORDER456");

      expect(result.success).toBe(true);
      expect(result.items_added).toHaveLength(1);
      expect(result.items_added[0].name).toBe("Bread");
      expect(vi.mocked(getOrderDetailsFlow)).not.toHaveBeenCalled();
    });

    test("fetches order details when not found in recent orders", async () => {
      const mockRecentOrders: OrderDetails[] = [
        {
          order_id: "ORDER123",
          date: "2026-03-08",
          total: 500,
          item_count: 1,
          status: "delivered",
          items: [
            {
              product_id: "PROD1",
              name: "Milk 1L",
              quantity: 1,
              original_price: 60,
            },
          ],
        },
      ];

      const mockOldOrder: OrderDetails = {
        order_id: "OLDORDER999",
        date: "2026-01-01",
        total: 200,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD3",
            name: "Eggs",
            quantity: 1,
            original_price: 80,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue(mockRecentOrders);
      vi.mocked(getOrderDetailsFlow).mockResolvedValue(mockOldOrder);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD3",
            name: "Eggs",
            price: 80,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 80,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("OLDORDER999");

      expect(result.success).toBe(true);
      expect(result.items_added).toHaveLength(1);
      expect(result.items_added[0].name).toBe("Eggs");
      expect(vi.mocked(getOrderDetailsFlow)).toHaveBeenCalledWith(
        mockPage,
        "OLDORDER999"
      );
    });

    test("throws error when order has no items", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 0,
        item_count: 0,
        status: "cancelled",
        items: [],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      const service = new ReorderService(mockCtx);

      await expect(service.reorder("ORDER123")).rejects.toThrow(
        "Order ORDER123 has no items to reorder"
      );
    });
  });

  describe("exclude items", () => {
    test("excludes items from reorder", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 3,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
          {
            product_id: "PROD2",
            name: "Bread",
            quantity: 1,
            original_price: 40,
          },
          {
            product_id: "PROD3",
            name: "Butter",
            quantity: 1,
            original_price: 100,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD1",
              name: "Milk 1L",
              price: 60,
              in_stock: true,
            } as Product,
          ],
        })
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD3",
              name: "Butter",
              price: 100,
              in_stock: true,
            } as Product,
          ],
        });

      mockCartService.addToCart
        .mockResolvedValueOnce({
          success: true,
          quantity_added: 1,
          cart_total: 60,
        })
        .mockResolvedValueOnce({
          success: true,
          quantity_added: 1,
          cart_total: 160,
        });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("last", ["Bread"]);

      expect(result.success).toBe(true);
      expect(result.items_added).toHaveLength(2);
      expect(result.items_added.find((i) => i.name === "Bread")).toBeUndefined();
      expect(result.items_added.find((i) => i.name === "Milk 1L")).toBeDefined();
      expect(result.items_added.find((i) => i.name === "Butter")).toBeDefined();
    });

    test("handles case-insensitive exclusion", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("last", ["MILK 1L"]);

      expect(result.success).toBe(false);
      expect(result.items_added).toHaveLength(0);
      expect(mockProductService.search).not.toHaveBeenCalled();
    });

    test("trims whitespace in exclusion list", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      const service = new ReorderService(mockCtx);
      const result = await service.reorder("last", ["  Milk 1L  "]);

      expect(result.success).toBe(false);
      expect(result.items_added).toHaveLength(0);
    });
  });

  describe("unavailable items", () => {
    test("handles items not found in catalog", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Discontinued Product",
            quantity: 1,
            original_price: 100,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [],
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(false);
      expect(result.items_added).toHaveLength(0);
      expect(result.unavailable_items).toHaveLength(1);
      expect(result.unavailable_items[0]).toEqual({
        name: "Discontinued Product",
        reason: "Product not found in current catalog",
      });
    });

    test("handles out of stock items with alternatives", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1",
            name: "Milk 1L",
            price: 60,
            in_stock: false,
          } as Product,
          {
            id: "PROD1_ALT1",
            name: "Milk 1L Brand B",
            price: 65,
            in_stock: true,
          } as Product,
          {
            id: "PROD1_ALT2",
            name: "Milk 500ml",
            price: 35,
            in_stock: true,
          } as Product,
        ],
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(false);
      expect(result.items_added).toHaveLength(0);
      expect(result.unavailable_items).toHaveLength(1);
      expect(result.unavailable_items[0].name).toBe("Milk 1L");
      expect(result.unavailable_items[0].reason).toBe("Out of stock");
      expect(result.unavailable_items[0].alternatives).toHaveLength(2);
      expect(result.unavailable_items[0].alternatives![0]).toEqual({
        id: "PROD1_ALT1",
        name: "Milk 1L Brand B",
        price: 65,
        in_stock: true,
      });
    });

    test("handles out of stock items without alternatives", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1",
            name: "Milk 1L",
            price: 60,
            in_stock: false,
          } as Product,
        ],
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(false);
      expect(result.unavailable_items).toHaveLength(1);
      expect(result.unavailable_items[0].alternatives).toBeUndefined();
    });

    test("handles search failures gracefully", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockRejectedValue(
        new Error("Network error")
      );

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(false);
      expect(result.unavailable_items).toHaveLength(1);
      expect(result.unavailable_items[0]).toEqual({
        name: "Milk 1L",
        reason: "Search failed",
      });
    });

    test("handles cart add failures", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1",
            name: "Milk 1L",
            price: 60,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockRejectedValue(
        new Error("Cart service unavailable")
      );

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(false);
      expect(result.items_added).toHaveLength(0);
      expect(result.unavailable_items).toHaveLength(1);
      expect(result.unavailable_items[0]).toEqual({
        name: "Milk 1L",
        reason: "Failed to add to cart",
      });
    });
  });

  describe("partial success", () => {
    test("handles mixed success and failure", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 3,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
          {
            product_id: "PROD2",
            name: "Bread",
            quantity: 1,
            original_price: 40,
          },
          {
            product_id: "PROD3",
            name: "Butter",
            quantity: 1,
            original_price: 100,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD1",
              name: "Milk 1L",
              price: 60,
              in_stock: true,
            } as Product,
          ],
        })
        .mockResolvedValueOnce({
          products: [],
        })
        .mockResolvedValueOnce({
          products: [
            {
              id: "PROD3",
              name: "Butter",
              price: 100,
              in_stock: false,
            } as Product,
          ],
        });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 60,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(true);
      expect(result.items_added).toHaveLength(1);
      expect(result.items_added[0].name).toBe("Milk 1L");
      expect(result.unavailable_items).toHaveLength(2);
      expect(result.unavailable_items[0].name).toBe("Bread");
      expect(result.unavailable_items[0].reason).toBe(
        "Product not found in current catalog"
      );
      expect(result.unavailable_items[1].name).toBe("Butter");
      expect(result.unavailable_items[1].reason).toBe("Out of stock");
    });
  });

  describe("product matching", () => {
    test("matches by product_id when available", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            product_id: "PROD1",
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD1_NEW",
            name: "Milk 1L Brand A",
            price: 65,
            in_stock: true,
          } as Product,
          {
            id: "PROD1",
            name: "Milk 1L Original",
            price: 60,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 60,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(true);
      expect(result.items_added[0].name).toBe("Milk 1L Original");
      expect(mockCartService.addToCart).toHaveBeenCalledWith("PROD1", 1);
    });

    test("falls back to first search result when no product_id match", async () => {
      const mockOrder: OrderDetails = {
        order_id: "ORDER123",
        date: "2026-03-08",
        total: 500,
        item_count: 1,
        status: "delivered",
        items: [
          {
            name: "Milk 1L",
            quantity: 1,
            original_price: 60,
          },
        ],
      };

      vi.mocked(getOrdersFlow).mockResolvedValue([mockOrder]);

      mockProductService.search.mockResolvedValue({
        products: [
          {
            id: "PROD_BEST_MATCH",
            name: "Milk 1L",
            price: 60,
            in_stock: true,
          } as Product,
          {
            id: "PROD_OTHER",
            name: "Milk 2L",
            price: 120,
            in_stock: true,
          } as Product,
        ],
      });

      mockCartService.addToCart.mockResolvedValue({
        success: true,
        quantity_added: 1,
        cart_total: 60,
      });

      const service = new ReorderService(mockCtx);
      const result = await service.reorder();

      expect(result.success).toBe(true);
      expect(mockCartService.addToCart).toHaveBeenCalledWith(
        "PROD_BEST_MATCH",
        1
      );
    });
  });
});
