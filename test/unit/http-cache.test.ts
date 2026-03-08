import { describe, test, expect, beforeEach } from "vitest";
import { HttpCache } from "../../src/core/http-cache.ts";

describe("HttpCache", () => {
  let cache: HttpCache<string>;

  beforeEach(() => {
    cache = new HttpCache<string>(1000); // 1 second TTL for testing
  });

  test("stores and retrieves values", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");

    expect(cache.get("key1")).toBe("value1");
    expect(cache.get("key2")).toBe("value2");
  });

  test("returns undefined for non-existent keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  test("overwrites existing keys", () => {
    cache.set("key", "value1");
    cache.set("key", "value2");

    expect(cache.get("key")).toBe("value2");
  });

  test("expires entries after TTL", async () => {
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 1100));

    expect(cache.get("key")).toBeUndefined();
  });

  test("does not expire entries before TTL", async () => {
    cache.set("key", "value");

    // Wait for less than TTL
    await new Promise((r) => setTimeout(r, 500));

    expect(cache.get("key")).toBe("value");
  });

  test("clears all entries", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key3", "value3");

    cache.clear();

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
    expect(cache.get("key3")).toBeUndefined();
  });

  test("cleans up expired entries", async () => {
    const shortCache = new HttpCache<string>(100); // 100ms TTL
    shortCache.set("key1", "value1");
    shortCache.set("key2", "value2");

    // Wait for entries to expire
    await new Promise((r) => setTimeout(r, 150));

    // Add a new entry
    shortCache.set("key3", "value3");

    // Manual cleanup (normally done by interval)
    (shortCache as any).cleanup();

    expect(shortCache.get("key1")).toBeUndefined();
    expect(shortCache.get("key2")).toBeUndefined();
    expect(shortCache.get("key3")).toBe("value3");

    shortCache.destroy();
  });

  test("handles different data types", () => {
    const numberCache = new HttpCache<number>(1000);
    const objectCache = new HttpCache<{ foo: string }>(1000);

    numberCache.set("num", 42);
    objectCache.set("obj", { foo: "bar" });

    expect(numberCache.get("num")).toBe(42);
    expect(objectCache.get("obj")).toEqual({ foo: "bar" });

    numberCache.destroy();
    objectCache.destroy();
  });

  test("destroy clears cache and stops cleanup timer", () => {
    cache.set("key", "value");
    cache.destroy();

    expect(cache.get("key")).toBeUndefined();
  });

  test("uses default TTL when not specified", () => {
    const defaultCache = new HttpCache<string>();
    defaultCache.set("key", "value");

    expect(defaultCache.get("key")).toBe("value");
    defaultCache.destroy();
  });

  test("handles multiple concurrent operations", () => {
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    for (let i = 0; i < 100; i++) {
      expect(cache.get(`key${i}`)).toBe(`value${i}`);
    }
  });
});
