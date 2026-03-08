import type { RateLimiter } from "./rate-limiter.ts";
import type { Logger } from "./logger.ts";
import { HttpCache } from "./http-cache.ts";
import { RetryManager, isRetryableHttpError } from "./retry-manager.ts";
import { CircuitBreaker } from "./circuit-breaker.ts";
import { TIMEOUTS, DEFAULT_HEADERS, RETRY_DEFAULTS } from "../constants.ts";

export class BlinkitHttpClient {
  private rateLimiter: RateLimiter;
  private logger: Logger;
  private cache: HttpCache<{ ok: boolean; status: number; data: unknown }>;
  private retryManager: RetryManager;
  private circuitBreaker: CircuitBreaker;

  constructor(rateLimiter: RateLimiter, logger: Logger) {
    this.rateLimiter = rateLimiter;
    this.logger = logger;
    this.cache = new HttpCache();
    this.retryManager = new RetryManager({
      maxRetries: RETRY_DEFAULTS.MAX_RETRIES,
      baseDelay: RETRY_DEFAULTS.INITIAL_BACKOFF_MS,
      maxJitter: RETRY_DEFAULTS.MAX_JITTER_MS,
      retryableErrors: isRetryableHttpError,
    });
    this.circuitBreaker = new CircuitBreaker("blinkit-http", {
      failureThreshold: RETRY_DEFAULTS.CIRCUIT_BREAKER_THRESHOLD,
      resetTimeout: RETRY_DEFAULTS.CIRCUIT_BREAKER_RESET_MS,
    });
  }

  private getCacheKey(method: string, url: string, body?: unknown): string {
    const bodyStr = body ? JSON.stringify(body) : "";
    return `${method}:${url}:${bodyStr}`;
  }

  private shouldCache(method: string, url: string): boolean {
    // Cache GET requests and POST requests to search endpoint
    return method === "GET" || (method === "POST" && url.includes("/layout/search"));
  }

  async request<T = unknown>(
    url: string,
    options: {
      method?: string;
      body?: unknown;
      extraHeaders?: Record<string, string>;
    } = {}
  ): Promise<{ ok: boolean; status: number; data: T }> {
    const { method = "GET", body, extraHeaders = {} } = options;

    // Check cache first
    if (this.shouldCache(method, url)) {
      const cacheKey = this.getCacheKey(method, url, body);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${method} ${url}`);
        return cached as { ok: boolean; status: number; data: T };
      }
    }

    await this.rateLimiter.acquire();

    const headers: Record<string, string> = { ...DEFAULT_HEADERS, ...extraHeaders };

    this.logger.debug(`HTTP ${method} ${url}`);

    return this.circuitBreaker.execute(async () => {
      return this.retryManager.retry(
        async () => {
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
      const result = { ok: response.ok, status: response.status, data };

         // Throw error for 5xx status codes so they can be retried
         if (response.status >= 500) {
          const error = new Error(`HTTP ${method} request to ${url} failed with status ${response.status}`);
          (error as unknown as { status: number }).status = response.status;
          throw error;
        }


      // Cache successful responses
      if (this.shouldCache(method, url) && response.ok) {
        const cacheKey = this.getCacheKey(method, url, body);
        this.cache.set(cacheKey, result);
      }


         

      return result;
    } catch (error) {
      this.logger.error(`HTTP request failed: ${url}`, error);
      if (error instanceof DOMException && error.name === "AbortError") {
              //eslint-disable-next-line
        throw new Error(`HTTP ${method} request to ${url} timed out after ${TIMEOUTS.HTTP_REQUEST}ms. Blinkit may be slow or unreachable — check your network connection.`);
      }

       // Re-throw existing errors (including 5xx errors we created above)
       if (error instanceof Error) {
        throw error;
      }

      const msg = error instanceof Error ? error.message : String(error);
      //eslint-disable-next-line
      throw new Error(`HTTP ${method} request to ${url} failed: ${msg}. Check your network connection and that Blinkit is accessible.`);
    } finally {
      clearTimeout(timeout);
    }

      
        },
        (context) => {
          this.logger.warn(
            `Retrying HTTP ${method} ${url} (attempt ${context.attempt}/${RETRY_DEFAULTS.MAX_RETRIES}) after ${context.nextDelay}ms delay. Error: ${context.lastError instanceof Error ? context.lastError.message : String(context.lastError)}`
          );
        }
      );
    });
  }

  async get<T = unknown>(url: string, extraHeaders?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }> {
    return this.request<T>(url, { method: "GET", extraHeaders });
  }

  async post<T = unknown>(url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ ok: boolean; status: number; data: T }> {
    return this.request<T>(url, { method: "POST", body, extraHeaders });
  }
}
