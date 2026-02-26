import { RATE_LIMIT } from "../constants.ts";

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private lastRequest: number;
  private capacity: number;
  private refillRate: number;
  private minInterval: number;

  constructor(
    capacity = RATE_LIMIT.BUCKET_CAPACITY,
    refillRate = RATE_LIMIT.REFILL_RATE,
    minInterval = RATE_LIMIT.MIN_INTERVAL_MS
  ) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.minInterval = minInterval;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.lastRequest = 0;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    // Enforce minimum interval between requests
    const now = Date.now();
    const timeSinceLast = now - this.lastRequest;
    if (timeSinceLast < this.minInterval) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minInterval - timeSinceLast)
      );
    }

    // Wait for a token if bucket is empty
    while (this.tokens < 1) {
      const waitTime = ((1 - this.tokens) / this.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.refill();
    }

    this.tokens -= 1;
    this.lastRequest = Date.now();
  }
}
