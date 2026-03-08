import { describe, test, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../../src/services/auth-service.ts";
import type { AppContext } from "../../src/types.ts";
import type { Logger } from "../../src/core/logger.ts";
import type { BrowserManager } from "../../src/core/browser-manager.ts";
import type { SessionManager } from "../../src/core/session-manager.ts";
import type { Page, BrowserContext } from "playwright";

// Mock the playwright helpers and auth-flow modules
vi.mock("../../src/playwright/helpers.ts", () => ({
  checkLoggedIn: vi.fn(),
}));

vi.mock("../../src/playwright/auth-flow.ts", () => ({
  loginFlow: vi.fn(),
  enterOtpFlow: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

import { checkLoggedIn } from "../../src/playwright/helpers.ts";
import { loginFlow, enterOtpFlow } from "../../src/playwright/auth-flow.ts";
import { existsSync } from "fs";

describe("AuthService", () => {
  let mockContext: AppContext;
  let mockPage: Page;
  let mockBrowserContext: BrowserContext;
  let authService: AuthService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock page
    mockPage = {
      isClosed: vi.fn(() => false),
    } as unknown as Page;

    // Create mock browser context
    mockBrowserContext = {} as BrowserContext;

    // Create mock AppContext
    mockContext = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
      browserManager: {
        isRunning: vi.fn(() => false),
        getStorageStatePath: vi.fn(() => "/mock/path/storage.json"),
        ensurePage: vi.fn(async () => mockPage),
        saveStorageState: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        getContext: vi.fn(async () => mockBrowserContext),
      } as unknown as BrowserManager,
      sessionManager: {
        isAuthenticated: vi.fn(() => false),
        getPhone: vi.fn(() => null),
        setLoggedIn: vi.fn(),
        clear: vi.fn(),
        getSession: vi.fn(() => ({
          phone: null,
          lat: null,
          lon: null,
          logged_in: false,
        })),
        setLocation: vi.fn(),
      } as unknown as SessionManager,
      config: {} as any,
      httpClient: {} as any,
      rateLimiter: {} as any,
      spendingGuard: {} as any,
    };

    authService = new AuthService(mockContext);
  });

  describe("checkLoginStatus", () => {
    test("returns cached session when browser not running and no storage state", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(false);
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(mockContext.sessionManager.isAuthenticated).mockReturnValue(false);
      vi.mocked(mockContext.sessionManager.getPhone).mockReturnValue(null);

      const result = await authService.checkLoginStatus();

      expect(result).toEqual({ loggedIn: false, phone: null });
      expect(mockContext.browserManager.ensurePage).not.toHaveBeenCalled();
    });

    test("launches browser when storage state exists", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(false);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(checkLoggedIn).mockResolvedValue(true);
      vi.mocked(mockContext.sessionManager.getPhone).mockReturnValue("1234567890");

      const result = await authService.checkLoginStatus();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(checkLoggedIn).toHaveBeenCalledWith(mockPage);
      expect(mockContext.browserManager.saveStorageState).toHaveBeenCalled();
      expect(mockContext.sessionManager.setLoggedIn).toHaveBeenCalledWith(true);
      expect(result).toEqual({ loggedIn: true, phone: "1234567890" });
    });

    test("performs UI check when browser is already running", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(true);
      vi.mocked(checkLoggedIn).mockResolvedValue(false);
      vi.mocked(mockContext.sessionManager.getPhone).mockReturnValue(null);

      const result = await authService.checkLoginStatus();

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(checkLoggedIn).toHaveBeenCalledWith(mockPage);
      expect(mockContext.sessionManager.setLoggedIn).toHaveBeenCalledWith(false);
      expect(result).toEqual({ loggedIn: false, phone: null });
    });

    test("saves storage state when user is logged in", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(true);
      vi.mocked(checkLoggedIn).mockResolvedValue(true);
      vi.mocked(mockContext.sessionManager.getPhone).mockReturnValue("9876543210");

      const result = await authService.checkLoginStatus();

      expect(mockContext.browserManager.saveStorageState).toHaveBeenCalled();
      expect(result).toEqual({ loggedIn: true, phone: "9876543210" });
    });

    test("falls back to cached state when UI check fails", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(true);
      vi.mocked(mockContext.browserManager.ensurePage).mockRejectedValue(new Error("Browser error"));
      vi.mocked(mockContext.sessionManager.isAuthenticated).mockReturnValue(true);
      vi.mocked(mockContext.sessionManager.getPhone).mockReturnValue("5551234567");

      const result = await authService.checkLoginStatus();

      expect(result).toEqual({ loggedIn: true, phone: "5551234567" });
    });
  });

  describe("login", () => {
    test("initiates login flow with phone number", async () => {
      vi.mocked(checkLoggedIn).mockResolvedValue(false);
      vi.mocked(loginFlow).mockResolvedValue(undefined);

      const result = await authService.login("1234567890");

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(loginFlow).toHaveBeenCalledWith(mockPage, "1234567890");
      expect(mockContext.sessionManager.setLoggedIn).toHaveBeenCalledWith(false, "1234567890");
      expect(result).toBe("OTP sent to your phone. Use the enter_otp tool to complete login.");
    });

    test("returns early if already logged in", async () => {
      vi.mocked(checkLoggedIn).mockResolvedValue(true);

      const result = await authService.login("1234567890");

      expect(loginFlow).not.toHaveBeenCalled();
      expect(mockContext.sessionManager.setLoggedIn).not.toHaveBeenCalled();
      expect(result).toBe("Already logged in with valid session.");
    });

    test("continues login if check fails", async () => {
      vi.mocked(mockContext.browserManager.ensurePage).mockResolvedValueOnce(mockPage);
      vi.mocked(checkLoggedIn).mockRejectedValue(new Error("Check failed"));
      vi.mocked(loginFlow).mockResolvedValue(undefined);

      const result = await authService.login("9876543210");

      expect(loginFlow).toHaveBeenCalledWith(mockPage, "9876543210");
      expect(mockContext.sessionManager.setLoggedIn).toHaveBeenCalledWith(false, "9876543210");
      expect(result).toBe("OTP sent to your phone. Use the enter_otp tool to complete login.");
    });

    test("logs the phone number being used", async () => {
      vi.mocked(checkLoggedIn).mockResolvedValue(false);
      vi.mocked(loginFlow).mockResolvedValue(undefined);

      await authService.login("5551234567");

      expect(mockContext.logger.info).toHaveBeenCalledWith("Initiating login for phone: 5551234567");
    });
  });

  describe("enterOtp", () => {
    test("successfully completes login when OTP is valid", async () => {
      vi.mocked(enterOtpFlow).mockResolvedValue({ logged_in: true });

      const result = await authService.enterOtp("1234");

      expect(mockContext.browserManager.ensurePage).toHaveBeenCalled();
      expect(mockContext.browserManager.getContext).toHaveBeenCalled();
      expect(enterOtpFlow).toHaveBeenCalledWith(
        mockPage,
        mockBrowserContext,
        "1234",
        "/mock/path/storage.json"
      );
      expect(mockContext.sessionManager.setLoggedIn).toHaveBeenCalledWith(true);
      expect(result).toBe("Successfully logged in!");
    });

    test("returns verification message when login cannot be confirmed", async () => {
      vi.mocked(enterOtpFlow).mockResolvedValue({ logged_in: false });

      const result = await authService.enterOtp("1234");

      expect(enterOtpFlow).toHaveBeenCalled();
      expect(mockContext.sessionManager.setLoggedIn).not.toHaveBeenCalled();
      expect(result).toBe("OTP entered. Login could not be confirmed via UI — use check_login_status to verify.");
    });

    test("logs OTP entry and result", async () => {
      vi.mocked(enterOtpFlow).mockResolvedValue({ logged_in: true });

      await authService.enterOtp("5678");

      expect(mockContext.logger.info).toHaveBeenCalledWith("Entering OTP");
      expect(mockContext.logger.info).toHaveBeenCalledWith("OTP result: logged_in=true");
    });

    test("handles OTP flow with all required parameters", async () => {
      vi.mocked(enterOtpFlow).mockResolvedValue({ logged_in: false });
      const otp = "9999";

      await authService.enterOtp(otp);

      expect(enterOtpFlow).toHaveBeenCalledWith(
        mockPage,
        mockBrowserContext,
        otp,
        "/mock/path/storage.json"
      );
    });
  });

  describe("logout", () => {
    test("clears session and closes browser when running", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(true);

      await authService.logout();

      expect(mockContext.sessionManager.clear).toHaveBeenCalled();
      expect(mockContext.browserManager.close).toHaveBeenCalled();
    });

    test("only clears session when browser is not running", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(false);

      await authService.logout();

      expect(mockContext.sessionManager.clear).toHaveBeenCalled();
      expect(mockContext.browserManager.close).not.toHaveBeenCalled();
    });

    test("logs logout action", async () => {
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(false);

      await authService.logout();

      expect(mockContext.logger.info).toHaveBeenCalledWith("Logging out");
    });

    test("clears session before closing browser", async () => {
      const callOrder: string[] = [];
      vi.mocked(mockContext.sessionManager.clear).mockImplementation(() => {
        callOrder.push("clear");
      });
      vi.mocked(mockContext.browserManager.close).mockImplementation(async () => {
        callOrder.push("close");
      });
      vi.mocked(mockContext.browserManager.isRunning).mockReturnValue(true);

      await authService.logout();

      expect(callOrder).toEqual(["clear", "close"]);
    });
  });
});
