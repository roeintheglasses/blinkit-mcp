import { describe, test, expect, vi } from "vitest";
import { ProductService } from "../../src/services/product-service.ts";
import type { AppContext } from "../../src/types.ts";
import type { BlinkitHttpClient } from "../../src/core/http-client.ts";
import type { BrowserManager } from "../../src/core/browser-manager.ts";
import type { Logger } from "../../src/core/logger.ts";

// Create mock AppContext
function createMockContext(
  httpClientOverride?: Partial<BlinkitHttpClient>
): AppContext {
  const mockHttpClient: BlinkitHttpClient = {
    get: vi.fn(),
    post: vi.fn(),
    setSessionData: vi.fn(),
    ...httpClientOverride,
  } as unknown as BlinkitHttpClient;

  const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const mockBrowserManager: BrowserManager = {
    ensurePage: vi.fn(),
  } as unknown as BrowserManager;

  return {
    httpClient: mockHttpClient,
    logger: mockLogger,
    browserManager: mockBrowserManager,
  } as unknown as AppContext;
}

describe("ProductService", () => {
  describe("search", () => {
    test("returns products from HTTP API", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "123",
                  name: { text: "Milk" },
                  normal_price: { text: "₹60" },
                  mrp: { text: "₹65" },
                  variant: { text: "1L" },
                  image: { url: "https://example.com/milk.jpg" },
                  inventory: 10,
                  product_state: "available",
                  brand_name: { text: "Amul" },
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("milk");

      expect(result.products).toHaveLength(1);
      expect(result.products[0]).toEqual({
        id: "123",
        name: "Milk",
        price: 60,
        mrp: 65,
        unit: "1L",
        in_stock: true,
        image_url: "https://example.com/milk.jpg",
        brand: "Amul",
      });
      expect(result.total_results).toBe(1);
    });

    test("respects limit parameter", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "1",
                  name: { text: "Product 1" },
                  normal_price: { text: "₹10" },
                  inventory: 5,
                },
              },
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "2",
                  name: { text: "Product 2" },
                  normal_price: { text: "₹20" },
                  inventory: 5,
                },
              },
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "3",
                  name: { text: "Product 3" },
                  normal_price: { text: "₹30" },
                  inventory: 5,
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("test", 2);

      expect(result.products).toHaveLength(2);
      expect(result.products[0].id).toBe("1");
      expect(result.products[1].id).toBe("2");
    });

    test("handles products with atc_action cart_item data", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  atc_action: {
                    add_to_cart: {
                      cart_item: {
                        product_id: 456,
                        product_name: "Bread",
                        display_name: "Whole Wheat Bread",
                        price: 45,
                        mrp: 50,
                        unit: "400g",
                        inventory: 20,
                        image_url: "https://example.com/bread.jpg",
                        brand: "Britannia",
                      },
                    },
                  },
                  product_state: "available",
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("bread");

      expect(result.products[0]).toEqual({
        id: "456",
        name: "Bread",
        price: 45,
        mrp: 50,
        unit: "400g",
        in_stock: true,
        image_url: "https://example.com/bread.jpg",
        brand: "Britannia",
      });
    });

    test("handles out of stock products", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "789",
                  name: { text: "Out of Stock Item" },
                  normal_price: { text: "₹100" },
                  inventory: 0,
                  product_state: "out_of_stock",
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("item");

      expect(result.products[0].in_stock).toBe(false);
    });

    test("filters non-product snippets", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "banner_snippet",
                data: { title: "Banner" },
              },
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "123",
                  name: { text: "Valid Product" },
                  normal_price: { text: "₹50" },
                  inventory: 5,
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("test");

      expect(result.products).toHaveLength(1);
      expect(result.products[0].name).toBe("Valid Product");
    });

    test("returns empty array when no products found", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("nonexistent");

      expect(result.products).toHaveLength(0);
      expect(result.total_results).toBe(0);
    });

    test("handles missing optional fields gracefully", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          is_success: true,
          response: {
            snippets: [
              {
                widget_type: "product_card_snippet_type_2",
                data: {
                  product_id: "minimal",
                  name: { text: "Minimal Product" },
                  normal_price: { text: "₹25" },
                },
              },
            ],
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.search("minimal");

      expect(result.products[0]).toEqual({
        id: "minimal",
        name: "Minimal Product",
        price: 25,
        mrp: 25,
        unit: "",
        in_stock: false,
        image_url: "",
        brand: undefined,
      });
    });
  });

  describe("getDetails", () => {
    test("returns product details from HTTP API", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          product: {
            name: "Premium Milk",
            price: 65,
            mrp: 70,
            unit: "1L",
            brand: "Amul",
            description: "Fresh full cream milk",
            is_in_stock: true,
            image_url: "https://example.com/milk.jpg",
            images: [
              "https://example.com/milk-1.jpg",
              "https://example.com/milk-2.jpg",
            ],
            nutrition: {
              protein: "3.5g",
              fat: "6g",
            },
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.getDetails("123");

      expect(result).toEqual({
        id: "123",
        name: "Premium Milk",
        price: 65,
        mrp: 70,
        unit: "1L",
        brand: "Amul",
        description: "Fresh full cream milk",
        in_stock: true,
        image_url: "https://example.com/milk.jpg",
        images: [
          "https://example.com/milk-1.jpg",
          "https://example.com/milk-2.jpg",
        ],
        nutrition: {
          protein: "3.5g",
          fat: "6g",
        },
      });
    });

    test("handles missing optional fields with defaults", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          product: {
            name: "Basic Product",
            price: 50,
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.getDetails("456");

      expect(result).toEqual({
        id: "456",
        name: "Basic Product",
        price: 50,
        mrp: 50,
        unit: "",
        brand: undefined,
        description: undefined,
        in_stock: true,
        image_url: "",
        images: [],
        nutrition: undefined,
      });
    });

    test("uses image_url in images array when images not provided", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          product: {
            name: "Product",
            price: 100,
            image_url: "https://example.com/product.jpg",
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.getDetails("789");

      expect(result.images).toEqual(["https://example.com/product.jpg"]);
    });

    test("handles is_in_stock false", async () => {
      const mockPost = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          product: {
            name: "Unavailable Product",
            price: 75,
            is_in_stock: false,
          },
        },
      });

      const ctx = createMockContext({ post: mockPost });
      const service = new ProductService(ctx);

      const result = await service.getDetails("oos");

      expect(result.in_stock).toBe(false);
    });
  });

  describe("browseCategories", () => {
    test("returns categories from HTTP API", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          categories: [
            {
              id: "cat1",
              name: "Fruits & Vegetables",
              icon_url: "https://example.com/fruits.png",
            },
            {
              id: 2,
              name: "Dairy",
              icon_url: "https://example.com/dairy.png",
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategories();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "cat1",
        name: "Fruits & Vegetables",
        icon_url: "https://example.com/fruits.png",
      });
      expect(result[1]).toEqual({
        id: "2",
        name: "Dairy",
        icon_url: "https://example.com/dairy.png",
      });
    });

    test("handles missing optional icon_url", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          categories: [
            {
              id: "cat1",
              name: "Category Without Icon",
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategories();

      expect(result[0]).toEqual({
        id: "cat1",
        name: "Category Without Icon",
        icon_url: undefined,
      });
    });

    test("returns empty array when no categories", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          categories: [],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategories();

      expect(result).toHaveLength(0);
    });

    test("handles numeric category IDs", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          categories: [
            {
              id: 123,
              name: "Numeric ID Category",
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategories();

      expect(result[0].id).toBe("123");
    });
  });

  describe("browseCategory", () => {
    test("returns category products from HTTP API", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: [
            {
              product_id: "p1",
              name: "Apple",
              price: 120,
              mrp: 150,
              unit: "1kg",
              is_in_stock: true,
              image_url: "https://example.com/apple.jpg",
            },
            {
              product_id: 2,
              name: "Banana",
              price: 40,
              mrp: 45,
              unit: "6pcs",
              is_in_stock: true,
              image_url: "https://example.com/banana.jpg",
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("fruits");

      expect(result.products).toHaveLength(2);
      expect(result.total_results).toBe(2);
      expect(result.products[0]).toEqual({
        id: "p1",
        name: "Apple",
        price: 120,
        mrp: 150,
        unit: "1kg",
        in_stock: true,
        image_url: "https://example.com/apple.jpg",
      });
    });

    test("respects limit parameter", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: [
            { product_id: "1", name: "P1", price: 10, is_in_stock: true },
            { product_id: "2", name: "P2", price: 20, is_in_stock: true },
            { product_id: "3", name: "P3", price: 30, is_in_stock: true },
            { product_id: "4", name: "P4", price: 40, is_in_stock: true },
            { product_id: "5", name: "P5", price: 50, is_in_stock: true },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("category", 3);

      expect(result.products).toHaveLength(3);
      expect(result.total_results).toBe(5);
      expect(result.products[0].id).toBe("1");
      expect(result.products[2].id).toBe("3");
    });

    test("handles missing optional fields", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: [
            {
              product_id: "minimal",
              name: "Minimal Product",
              price: 25,
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("cat1");

      expect(result.products[0]).toEqual({
        id: "minimal",
        name: "Minimal Product",
        price: 25,
        mrp: 25,
        unit: "",
        in_stock: true,
        image_url: "",
      });
    });

    test("handles is_in_stock false", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: [
            {
              product_id: "oos",
              name: "Out of Stock",
              price: 100,
              is_in_stock: false,
            },
          ],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("cat1");

      expect(result.products[0].in_stock).toBe(false);
    });

    test("returns empty array when no products", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: [],
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("empty");

      expect(result.products).toHaveLength(0);
      expect(result.total_results).toBe(0);
    });

    test("uses default limit of 20", async () => {
      const mockGet = vi.fn().mockResolvedValue({
        ok: true,
        data: {
          products: Array.from({ length: 25 }, (_, i) => ({
            product_id: String(i),
            name: `Product ${i}`,
            price: 10,
            is_in_stock: true,
          })),
        },
      });

      const ctx = createMockContext({ get: mockGet });
      const service = new ProductService(ctx);

      const result = await service.browseCategory("cat1");

      expect(result.products).toHaveLength(20);
      expect(result.total_results).toBe(25);
    });
  });
});
