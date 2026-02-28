import { firefox, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Logger } from "./logger.ts";
import type { BlinkitConfig } from "../config/schema.ts";
import type { SessionManager } from "./session-manager.ts";
import { CONFIG_DIR, COOKIES_DIR, STORAGE_STATE_FILE } from "../constants.ts";
import { SELECTORS } from "../playwright/selectors.ts";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logger: Logger;
  private config: BlinkitConfig;
  private sessionManager: SessionManager | null = null;

  constructor(logger: Logger, config: BlinkitConfig) {
    this.logger = logger;
    this.config = config;
  }

  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm;
  }

  getStorageStatePath(): string {
    return join(homedir(), CONFIG_DIR, COOKIES_DIR, STORAGE_STATE_FILE);
  }

  /**
   * Lazily initialize browser, context, and page. Load storage state if exists.
   * Navigates to blinkit.com and handles initial popups.
   */
  async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    if (!this.browser) {
      const headless = this.config.debug ? false : this.config.headless;
      this.browser = await firefox.launch({
        headless,
        ...(this.config.slow_mo ? { slowMo: this.config.slow_mo } : {}),
      });
    }

    // Create context with storage state if available
    const storagePath = this.getStorageStatePath();
    const session = this.sessionManager?.getSession();
    const lat = session?.lat ?? this.config.default_lat ?? 28.6139;
    const lon = session?.lon ?? this.config.default_lon ?? 77.209;

    const contextOptions: any = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
      viewport: { width: 1280, height: 800 },
      permissions: ["geolocation"],
      geolocation: { latitude: lat, longitude: lon },
    };

    if (existsSync(storagePath)) {
      this.logger.info(`Loading session from ${storagePath}`);
      contextOptions.storageState = storagePath;
    }

    try {
      this.context = await this.browser.newContext(contextOptions);
    } catch (e) {
      this.logger.warn(`Failed to create context with storage state: ${e}, trying without`);
      delete contextOptions.storageState;
      this.context = await this.browser.newContext(contextOptions);
    }

    // Monitor payment-related network responses
    this.context.on("response", async (response) => {
      try {
        const url = response.url();
        if (url.includes("zpaykit") || url.includes("payment")) {
          if (response.status() >= 400) {
            this.logger.debug(`Payment API Error ${response.status()} at ${url}`);
          }
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("application/json")) {
            try {
              const data = await response.json();
              if (data && (data.status === "failed" || data.error)) {
                this.logger.debug(`Payment API Failure: ${JSON.stringify(data)}`);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch {
        // ignore
      }
    });

    this.page = await this.context.newPage();

    // Navigate to blinkit.com
    try {
      await this.page.goto(`https://blinkit.com`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      this.logger.info("Opened blinkit.com");
    } catch (e) {
      this.logger.warn(`Warning: Navigation to Blinkit took too long or failed: ${e}. Proceeding.`);
    }

    // Handle "Detect my location" popup
    try {
      const locationBtn = this.page.locator("button").filter({ hasText: SELECTORS.DETECT_MY_LOCATION });
      try {
        await locationBtn.waitFor({ state: "visible", timeout: 3000 });
        this.logger.info("Location popup detected. Clicking 'Detect my location'...");
        await locationBtn.click();
        await locationBtn.waitFor({ state: "hidden", timeout: 5000 });
        this.logger.info("Location popup dismissed.");
      } catch {
        // Timed out -- popup didn't appear or already handled
      }
    } catch (e) {
      this.logger.debug(`Note: Error checking location popup: ${e}`);
    }

    this.logger.info("Browser initialized and ready");
    return this.page;
  }

  async getContext(): Promise<BrowserContext> {
    await this.ensurePage(); // ensures context is created
    return this.context!;
  }

  async saveStorageState(): Promise<void> {
    if (!this.context) return;
    const path = this.getStorageStatePath();
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    try {
      await this.context.storageState({ path });
      this.logger.info(`Storage state saved to ${path}`);
    } catch (e) {
      this.logger.warn(`Failed to save storage state: ${e}`);
    }
  }

  async close(): Promise<void> {
    // Save session before closing
    await this.saveStorageState();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }

  async captureErrorScreenshot(toolName: string): Promise<string | null> {
    try {
      if (!this.page || this.page.isClosed()) return null;

      const debugDir = join(homedir(), CONFIG_DIR, "debug-screenshots");
      if (!existsSync(debugDir)) {
        mkdirSync(debugDir, { recursive: true, mode: 0o700 });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${toolName}-${timestamp}.png`;
      const filePath = join(debugDir, filename);

      await this.page.screenshot({ path: filePath, fullPage: false });
      this.logger.info(`Debug screenshot saved to ${filePath}`);
      return filePath;
    } catch (e) {
      this.logger.debug(`Failed to capture error screenshot: ${e}`);
      return null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null && this.page !== null && !this.page.isClosed();
  }
}
