export interface Product {
  id: string;
  name: string;
  price: number;
  mrp: number;
  unit: string;
  in_stock: boolean;
  image_url: string;
  brand?: string;
  description?: string;
  category?: string;
}

export interface ProductDetails extends Product {
  nutrition?: Record<string, string>;
  images: string[];
  variants?: { name: string; price: number; unit: string }[];
}

export interface CartItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  item_count: number;
  spending_warning?: string;
}

export interface Address {
  index: number;
  label: string;
  address_line: string;
  is_default: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon_url?: string;
}

export interface OrderSummary {
  order_id: string;
  date: string;
  total: number;
  item_count: number;
  status: string;
  items_summary: string;
}

export interface OrderTracking {
  order_id: string;
  status: string;
  eta_minutes?: number;
  delivery_partner?: string;
  timeline: { time: string; status: string }[];
}

export interface SessionData {
  phone: string | null;
  lat: number | null;
  lon: number | null;
  logged_in: boolean;
}

export interface SpendingCheckResult {
  allowed: boolean;
  warning?: string;
  exceeded_hard_limit: boolean;
}

export interface BridgeCommand {
  id: string;
  action: string;
  params: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AppContext {
  config: import("./config/schema.ts").BlinkitConfig;
  httpClient: import("./core/http-client.ts").BlinkitHttpClient;
  browserManager: import("./core/browser-manager.ts").BrowserManager;
  sessionManager: import("./core/session-manager.ts").SessionManager;
  rateLimiter: import("./core/rate-limiter.ts").RateLimiter;
  spendingGuard: import("./services/spending-guard.ts").SpendingGuard;
  logger: import("./core/logger.ts").Logger;
}
