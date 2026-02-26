import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ConfigSchema } from "../../src/config/schema.ts";

describe("ConfigSchema", () => {
  test("parses with all defaults", () => {
    const config = ConfigSchema.parse({});
    expect(config.warn_threshold).toBe(500);
    expect(config.max_order_amount).toBe(2000);
    expect(config.headless).toBe(true);
    expect(config.playwright_mode).toBe("bridge");
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

  test("accepts playwright_mode direct", () => {
    const config = ConfigSchema.parse({ playwright_mode: "direct" });
    expect(config.playwright_mode).toBe("direct");
  });

  test("rejects invalid playwright_mode", () => {
    expect(() => ConfigSchema.parse({ playwright_mode: "invalid" })).toThrow();
  });
});
