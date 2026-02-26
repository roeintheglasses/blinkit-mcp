import type { AppContext, Product, ProductDetails } from "../types.ts";
import { ENDPOINTS } from "../constants.ts";

export class ProductService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async search(query: string, limit = 10): Promise<{ products: Product[]; total_results: number }> {
    // Try HTTP first — POST to /v1/layout/search?q=...&search_type=type_to_search
    try {
      const url = `${ENDPOINTS.SEARCH}?q=${encodeURIComponent(query)}&search_type=type_to_search`;
      const result = await this.ctx.httpClient.post<{
        is_success?: boolean;
        response?: {
          snippets?: Array<{
            widget_type?: string;
            data?: {
              product_id?: string;
              identity?: { id?: string };
              name?: { text?: string };
              display_name?: { text?: string };
              normal_price?: { text?: string };
              mrp?: { text?: string };
              variant?: { text?: string };
              image?: { url?: string };
              inventory?: number;
              product_state?: string;
              brand_name?: { text?: string };
              atc_action?: {
                add_to_cart?: {
                  cart_item?: {
                    product_id?: number;
                    product_name?: string;
                    display_name?: string;
                    price?: number;
                    mrp?: number;
                    unit?: string;
                    inventory?: number;
                    image_url?: string;
                    brand?: string;
                  };
                };
              };
            };
          }>;
        };
      }>(url, {});

      if (result.ok && result.data?.is_success && result.data.response?.snippets) {
        const snippets = result.data.response.snippets;
        const products: Product[] = [];

        for (const snippet of snippets) {
          if (products.length >= limit) break;
          if (snippet.widget_type !== "product_card_snippet_type_2") continue;

          const d = snippet.data;
          if (!d) continue;

          const cartItem = d.atc_action?.add_to_cart?.cart_item;
          if (cartItem) {
            products.push({
              id: String(cartItem.product_id ?? ""),
              name: cartItem.product_name ?? cartItem.display_name ?? "Unknown",
              price: cartItem.price ?? 0,
              mrp: cartItem.mrp ?? cartItem.price ?? 0,
              unit: cartItem.unit ?? "",
              in_stock: (cartItem.inventory ?? 0) > 0 && d.product_state !== "out_of_stock",
              image_url: cartItem.image_url ?? d.image?.url ?? "",
              brand: cartItem.brand ?? d.brand_name?.text,
            });
          } else {
            const priceText = d.normal_price?.text ?? "";
            const price = parseFloat(priceText.replace(/[^0-9.]/g, "")) || 0;
            const mrpText = d.mrp?.text ?? priceText;
            const mrp = parseFloat(mrpText.replace(/[^0-9.]/g, "")) || price;

            products.push({
              id: d.product_id ?? d.identity?.id ?? "",
              name: d.name?.text ?? d.display_name?.text ?? "Unknown",
              price,
              mrp,
              unit: d.variant?.text ?? "",
              in_stock: (d.inventory ?? 0) > 0 && d.product_state !== "out_of_stock",
              image_url: d.image?.url ?? "",
              brand: d.brand_name?.text,
            });
          }
        }

        return { products, total_results: products.length };
      }
    } catch (e) {
      this.ctx.logger.debug("HTTP search failed, falling back to Playwright", e);
    }

    // Playwright fallback
    const result = await this.ctx.browserManager.sendCommand("search", { query, limit });
    if (!result.success) {
      throw new Error(result.error ?? "Search failed");
    }

    const data = result.data as { products: Product[] };
    return { products: data.products, total_results: data.products.length };
  }

  async getDetails(productId: string): Promise<ProductDetails> {
    // Try HTTP first
    try {
      const result = await this.ctx.httpClient.post<{
        product?: {
          name?: string;
          price?: number;
          mrp?: number;
          unit?: string;
          brand?: string;
          description?: string;
          is_in_stock?: boolean;
          image_url?: string;
          images?: string[];
          nutrition?: Record<string, string>;
        };
      }>(ENDPOINTS.PRODUCT_DETAILS(productId), {});

      if (result.ok && result.data?.product) {
        const p = result.data.product;
        return {
          id: productId,
          name: p.name ?? "Unknown",
          price: p.price ?? 0,
          mrp: p.mrp ?? p.price ?? 0,
          unit: p.unit ?? "",
          brand: p.brand,
          description: p.description,
          in_stock: p.is_in_stock !== false,
          image_url: p.image_url ?? "",
          images: p.images ?? (p.image_url ? [p.image_url] : []),
          nutrition: p.nutrition,
        };
      }
    } catch (e) {
      this.ctx.logger.debug("HTTP product details failed, falling back to Playwright", e);
    }

    // Playwright fallback
    const result = await this.ctx.browserManager.sendCommand("getProductDetails", { productId });
    if (!result.success) {
      throw new Error(result.error ?? "Failed to get product details");
    }

    const data = result.data as Record<string, unknown>;
    return {
      id: productId,
      name: (data.name as string) ?? "Unknown",
      price: (data.price as number) ?? 0,
      mrp: (data.mrp as number) ?? (data.price as number) ?? 0,
      unit: (data.unit as string) ?? "",
      brand: data.brand as string | undefined,
      description: data.description as string | undefined,
      in_stock: (data.in_stock as boolean) !== false,
      image_url: (data.image_url as string) ?? "",
      images: (data.images as string[]) ?? [],
    };
  }

  async browseCategories(): Promise<{ id: string; name: string; icon_url?: string }[]> {
    // Try HTTP first
    try {
      const result = await this.ctx.httpClient.get<{
        categories?: Array<{
          id?: string | number;
          name?: string;
          icon_url?: string;
        }>;
      }>(ENDPOINTS.CATEGORIES);

      if (result.ok && result.data?.categories) {
        return result.data.categories.map((c) => ({
          id: String(c.id ?? ""),
          name: c.name ?? "Unknown",
          icon_url: c.icon_url,
        }));
      }
    } catch (e) {
      this.ctx.logger.debug("HTTP categories failed, falling back to Playwright", e);
    }

    // Playwright fallback
    const result = await this.ctx.browserManager.sendCommand("browseCategories", {});
    if (!result.success) {
      throw new Error(result.error ?? "Failed to browse categories");
    }

    const data = result.data as { categories: { id: string; name: string; icon_url?: string }[] };
    return data.categories;
  }

  async browseCategory(
    categoryId: string,
    limit = 20
  ): Promise<{ products: Product[]; total_results: number }> {
    // Try HTTP first
    try {
      const result = await this.ctx.httpClient.get<{
        products?: Array<{
          product_id?: string | number;
          name?: string;
          price?: number;
          mrp?: number;
          unit?: string;
          is_in_stock?: boolean;
          image_url?: string;
        }>;
      }>(ENDPOINTS.CATEGORY_PRODUCTS(categoryId));

      if (result.ok && result.data?.products) {
        const products: Product[] = result.data.products.slice(0, limit).map((p) => ({
          id: String(p.product_id ?? ""),
          name: p.name ?? "Unknown",
          price: p.price ?? 0,
          mrp: p.mrp ?? p.price ?? 0,
          unit: p.unit ?? "",
          in_stock: p.is_in_stock !== false,
          image_url: p.image_url ?? "",
        }));
        return { products, total_results: result.data.products.length };
      }
    } catch (e) {
      this.ctx.logger.debug("HTTP category products failed, falling back to Playwright", e);
    }

    // Playwright fallback
    const result = await this.ctx.browserManager.sendCommand("browseCategory", { categoryId, limit });
    if (!result.success) {
      throw new Error(result.error ?? "Failed to browse category");
    }

    const data = result.data as { products: Product[] };
    return { products: data.products, total_results: data.products.length };
  }
}
