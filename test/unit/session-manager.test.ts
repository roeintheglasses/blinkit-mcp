import { describe, test, expect } from "bun:test";
import { SessionManager } from "../../src/core/session-manager.ts";
import { Logger } from "../../src/core/logger.ts";

// Note: SessionManager uses ~/.blinkit-mcp/auth.json which we can't easily redirect.
// These tests focus on in-memory behavior.

describe("SessionManager", () => {
  const logger = new Logger("error"); // suppress noise

  test("starts unauthenticated", () => {
    const sm = new SessionManager(logger);
    expect(sm.isAuthenticated()).toBe(false);
    expect(sm.getPhone()).toBeNull();
  });

  test("becomes authenticated after setLoggedIn", () => {
    const sm = new SessionManager(logger);
    sm.setLoggedIn(true, "9876543210");

    expect(sm.isAuthenticated()).toBe(true);
    expect(sm.getPhone()).toBe("9876543210");
  });

  test("setLocation updates session coordinates", () => {
    const sm = new SessionManager(logger);
    sm.setLocation(28.6139, 77.209);

    const session = sm.getSession();
    expect(session.lat).toBe(28.6139);
    expect(session.lon).toBe(77.209);
  });

  test("location is null by default", () => {
    const sm = new SessionManager(logger);
    const session = sm.getSession();
    expect(session.lat).toBeNull();
    expect(session.lon).toBeNull();
  });

  test("clear resets session", () => {
    const sm = new SessionManager(logger);
    sm.setLoggedIn(true, "1234567890");
    expect(sm.isAuthenticated()).toBe(true);

    sm.clear();
    expect(sm.isAuthenticated()).toBe(false);
    expect(sm.getPhone()).toBeNull();
  });

  test("getSession returns full session data", () => {
    const sm = new SessionManager(logger);
    const session = sm.getSession();
    expect(session.phone).toBeNull();
    expect(session.lat).toBeNull();
    expect(session.lon).toBeNull();
    expect(session.logged_in).toBe(false);
  });

  test("getSession reflects setLoggedIn changes", () => {
    const sm = new SessionManager(logger);
    sm.setLoggedIn(true, "5551234567");

    const session = sm.getSession();
    expect(session.logged_in).toBe(true);
    expect(session.phone).toBe("5551234567");
  });

  test("setLoggedIn without phone preserves existing phone", () => {
    const sm = new SessionManager(logger);
    sm.setLoggedIn(true, "9876543210");
    expect(sm.getPhone()).toBe("9876543210");

    sm.setLoggedIn(false);
    expect(sm.getPhone()).toBe("9876543210");
    expect(sm.isAuthenticated()).toBe(false);
  });

  test("clear resets logged_in flag", () => {
    const sm = new SessionManager(logger);
    sm.setLoggedIn(true);
    expect(sm.isAuthenticated()).toBe(true);

    sm.clear();
    expect(sm.isAuthenticated()).toBe(false);
  });

  test("getSession returns correct shape", () => {
    const sm = new SessionManager(logger);
    const session = sm.getSession();

    // SessionData should have exactly these fields
    expect("phone" in session).toBe(true);
    expect("lat" in session).toBe(true);
    expect("lon" in session).toBe(true);
    expect("logged_in" in session).toBe(true);
  });

  test("setLocation persists across getSession calls", () => {
    const sm = new SessionManager(logger);
    sm.setLocation(12.9716, 77.5946);

    const session1 = sm.getSession();
    const session2 = sm.getSession();
    expect(session1.lat).toBe(12.9716);
    expect(session2.lat).toBe(12.9716);
    expect(session1.lon).toBe(77.5946);
    expect(session2.lon).toBe(77.5946);
  });
});
