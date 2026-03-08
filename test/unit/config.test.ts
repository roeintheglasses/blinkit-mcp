import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("ConfigSchema", () => {
  test("parses with all defaults", () => {
    const config = ConfigSchema.parse({});
    expect(config.warn_threshold).toBe(500);
    expect(config.max_order_amount).toBe(2000);
    expect(config.headless).toBe(true);
    expect(config.default_lat).toBeUndefined();
    expect(config.default_lon).toBeUndefined();
  });

  test("accepts valid coordinates", () => {
    const config = ConfigSchema.parse({
      default_lat: 28.6139,
      default_lon: 77.209,
    });
    expect(config.default_lat).toBe(28.6139);
    expect(config.default_lon).toBe(77.209);
  });

  test("rejects invalid latitude", () => {
    expect(() => ConfigSchema.parse({ default_lat: 91 })).toThrow();
    expect(() => ConfigSchema.parse({ default_lat: -91 })).toThrow();
  });

  test("rejects invalid longitude", () => {
    expect(() => ConfigSchema.parse({ default_lon: 181 })).toThrow();
    expect(() => ConfigSchema.parse({ default_lon: -181 })).toThrow();
  });

  test("rejects non-positive thresholds", () => {
    expect(() => ConfigSchema.parse({ warn_threshold: 0 })).toThrow();
    expect(() => ConfigSchema.parse({ warn_threshold: -100 })).toThrow();
    expect(() => ConfigSchema.parse({ max_order_amount: 0 })).toThrow();
  });

  test("accepts custom thresholds", () => {
    const config = ConfigSchema.parse({
      warn_threshold: 1000,
      max_order_amount: 5000,
    });
    expect(config.warn_threshold).toBe(1000);
    expect(config.max_order_amount).toBe(5000);
  });

  test("accepts headless=false", () => {
    const config = ConfigSchema.parse({ headless: false });
    expect(config.headless).toBe(false);
  });

  test("accepts debug mode", () => {
    const config = ConfigSchema.parse({ debug: true });
    expect(config.debug).toBe(true);
  });

  test("uses default retry parameters", () => {
    const config = ConfigSchema.parse({});
    expect(config.max_retries).toBe(3);
    expect(config.backoff_multiplier).toBe(2);
    expect(config.circuit_breaker_threshold).toBe(5);
  });

  test("accepts custom retry parameters", () => {
    const config = ConfigSchema.parse({
      max_retries: 5,
      backoff_multiplier: 3,
      circuit_breaker_threshold: 10,
    });
    expect(config.max_retries).toBe(5);
    expect(config.backoff_multiplier).toBe(3);
    expect(config.circuit_breaker_threshold).toBe(10);
  });

  test("rejects invalid retry parameters", () => {
    expect(() => ConfigSchema.parse({ max_retries: -1 })).toThrow();
    expect(() => ConfigSchema.parse({ backoff_multiplier: 0 })).toThrow();
    expect(() => ConfigSchema.parse({ backoff_multiplier: -1 })).toThrow();
    expect(() => ConfigSchema.parse({ circuit_breaker_threshold: 0 })).toThrow();
    expect(() => ConfigSchema.parse({ circuit_breaker_threshold: -1 })).toThrow();
  });
});
