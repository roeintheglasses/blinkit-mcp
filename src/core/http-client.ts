import type { RateLimiter } from "./rate-limiter.ts";
import type { Logger } from "./logger.ts";
import { TIMEOUTS, DEFAULT_HEADERS } from "../constants.ts";

export class BlinkitHttpClient {
  private rateLimiter: RateLimiter;
  private logger: Logger;

  constructor(rateLimiter: RateLimiter, logger: Logger) {
    this.rateLimiter = rateLimiter;
    this.logger = logger;
  }

  async request<T = unknown>(
    url: string,
    options: {
      method?: string;
      body?: unknown;
      extraHeaders?: Record<string, string>;
    } = {}
  ): Promise<{ ok: boolean; status: number; data: T }> {
    await this.rateLimiter.acquire();

    const { method = "GET", body, extraHeaders = {} } = options;
    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...extraHeaders };

    this.logger.debug(`HTTP ${method} ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUTS.HTTP_REQUEST);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = (await response.json()) as T;
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      this.logger.error(`HTTP request failed: ${url}`, error);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`HTTP ${method} request to ${url} timed out after ${TIMEOUTS.HTTP_REQUEST}ms. Blinkit may be slow or unreachable — check your network connection.`);
      }
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`HTTP ${method} request to ${url} failed: ${msg}. Check your network connection and that Blinkit is accessible.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async get<T = unknown>(url: string, extraHeaders?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }> {
    return this.request<T>(url, { method: "GET", extraHeaders });
  }

  async post<T = unknown>(url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }> {
    return this.request<T>(url, { method: "POST", body, extraHeaders });
  }
}
