import { existsSync } from "fs";
import type { AppContext } from "../types.js";
import { checkLoggedIn } from "../playwright/helpers.js";
import { loginFlow, enterOtpFlow } from "../playwright/auth-flow.js";

export class AuthService {
  private ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async checkLoginStatus(): Promise<{ loggedIn: boolean; phone: string | null }> {
    // If browser isn't running, check if we have saved cookies to verify against
    if (!this.ctx.browserManager.isRunning()) {
      const hasStorageState = existsSync(this.ctx.browserManager.getStorageStatePath());

      if (!hasStorageState) {
        // No saved browser state — return cached session
        return {
          loggedIn: this.ctx.sessionManager.isAuthenticated(),
          phone: this.ctx.sessionManager.getPhone(),
        };
      }

      // Storage state exists — launch browser to verify login
      this.ctx.logger.info("Saved cookies found, launching browser to verify login status");
    }

    // Browser is running (or being launched) — do a UI-based login check
    try {
      const page = await this.ctx.browserManager.ensurePage();
      const loggedIn = await checkLoggedIn(page);
      if (loggedIn) {
        await this.ctx.browserManager.saveStorageState();
      }
      this.ctx.sessionManager.setLoggedIn(loggedIn);
      return { loggedIn, phone: this.ctx.sessionManager.getPhone() };
    } catch (e) {
      this.ctx.logger.debug("UI login check failed, using cached state", e);
    }

    return {
      loggedIn: this.ctx.sessionManager.isAuthenticated(),
      phone: this.ctx.sessionManager.getPhone(),
    };
  }

  async login(phoneNumber: string): Promise<string> {
    this.ctx.logger.info(`Initiating login for phone: ${phoneNumber}`);

    // Check if already logged in
    try {
      const page = await this.ctx.browserManager.ensurePage();
      const loggedIn = await checkLoggedIn(page);
      if (loggedIn) {
        return "Already logged in with valid session.";
      }
    } catch {
      // Continue with login
    }

    const page = await this.ctx.browserManager.ensurePage();
    await loginFlow(page, phoneNumber);

    this.ctx.sessionManager.setLoggedIn(false, phoneNumber);
    return "OTP sent to your phone. Use the enter_otp tool to complete login.";
  }

  async enterOtp(otp: string): Promise<string> {
    this.ctx.logger.info("Entering OTP");

    const page = await this.ctx.browserManager.ensurePage();
    const context = await this.ctx.browserManager.getContext();
    const storageStatePath = this.ctx.browserManager.getStorageStatePath();

    const data = await enterOtpFlow(page, context, otp, storageStatePath);
    this.ctx.logger.info(`OTP result: logged_in=${data.logged_in}`);

    if (data.logged_in) {
      this.ctx.sessionManager.setLoggedIn(true);
      return "Successfully logged in!";
    }

    // OTP was entered but we couldn't confirm login via UI — don't overwrite
    // session as false since the cookies may still be valid (storage state was saved).
    // Next checkLoginStatus call will verify properly.
    return "OTP entered. Login could not be confirmed via UI — use check_login_status to verify.";
  }

  async logout(): Promise<void> {
    this.ctx.logger.info("Logging out");
    this.ctx.sessionManager.clear();

    if (this.ctx.browserManager.isRunning()) {
      await this.ctx.browserManager.close();
    }
  }
}
