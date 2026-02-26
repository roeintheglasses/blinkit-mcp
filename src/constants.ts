export const BLINKIT_BASE_URL = "https://blinkit.com";
export const BLINKIT_API_BASE = "https://blinkit.com";
export const BLINKIT_SEARCH_BASE = "https://blinkit.in";

export const ENDPOINTS = {
  PRODUCT_DETAILS: (prid: string) =>
    `${BLINKIT_API_BASE}/v1/layout/product/${prid}`,
  SEARCH: `${BLINKIT_API_BASE}/v1/layout/search`,
  CATEGORIES: `${BLINKIT_API_BASE}/v2/categories`,
  CATEGORY_PRODUCTS: (categoryId: string) =>
    `${BLINKIT_API_BASE}/v6/category/products/${categoryId}`,
  CART: `${BLINKIT_API_BASE}/v2/cart`,
  CART_ADD: `${BLINKIT_API_BASE}/v1/cart/add`,
  CART_UPDATE: `${BLINKIT_API_BASE}/v1/cart/update`,
  CART_CLEAR: `${BLINKIT_API_BASE}/v1/cart/clear`,
  ORDERS: `${BLINKIT_API_BASE}/v2/orders`,
  ORDER_TRACK: (orderId: string) =>
    `${BLINKIT_API_BASE}/v2/order/${orderId}/track`,
} as const;

export const DEFAULT_HEADERS = {
  "app_client": "consumer_web",
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
} as const;

export const RATE_LIMIT = {
  BUCKET_CAPACITY: 5,
  REFILL_RATE: 2, // tokens per second
  MIN_INTERVAL_MS: 200,
} as const;

export const TIMEOUTS = {
  BRIDGE_COMMAND: 60_000,
  HTTP_REQUEST: 15_000,
  BRIDGE_STARTUP: 10_000,
} as const;

export const CONFIG_DIR = ".blinkit-mcp";
export const AUTH_FILE = "auth.json";
export const COOKIES_DIR = "cookies";
export const STORAGE_STATE_FILE = "auth.json";
export const CONFIG_FILE = "config.json";
