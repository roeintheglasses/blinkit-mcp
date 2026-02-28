import type { Page, BrowserContext } from "playwright";
import { debugStep, checkLoggedIn } from "./helpers.ts";
import { SELECTORS } from "./selectors.ts";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

/**
 * Login flow: navigates to blinkit, clicks Login, fills phone number, clicks Continue.
 * After this returns, an OTP should be sent to the phone.
 * Throws on failure.
 */
export async function loginFlow(page: Page, phoneNumber: string): Promise<void> {
  await debugStep(page, "Navigating to blinkit.com");

  // Check if already on blinkit
  if (!page.url().includes("blinkit.com")) {
    await page.goto("https://blinkit.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
  }

  // Click Login button -- try multiple strategies
  await debugStep(page, "Looking for Login button");
  if (await page.isVisible(SELECTORS.LOGIN_BUTTON)) {
    await debugStep(page, "Clicking Login text button");
    await page.click(SELECTORS.LOGIN_BUTTON);
  } else if (await page.isVisible(SELECTORS.PROFILE_BUTTON_CONTAINER)) {
    await debugStep(page, "Clicking ProfileButton container");
    await page.locator(SELECTORS.PROFILE_BUTTON_CONTAINER).click();
  } else {
    log("Login button not found, checking if already on login screen");
  }
  await page.waitForTimeout(1000);

  // Wait for phone input
  await debugStep(page, "Waiting for phone number input");
  const phoneInput = await page.waitForSelector(
    SELECTORS.PHONE_INPUT,
    { state: "visible", timeout: 30000 }
  );
  if (phoneInput) {
    await debugStep(page, `Filling phone number: ${phoneNumber}`);
    await phoneInput.click();
    await phoneInput.fill(phoneNumber);
    await page.waitForTimeout(500);

    // Submit
    await debugStep(page, "Submitting phone number");
    if (await page.isVisible(SELECTORS.NEXT_BUTTON)) {
      await page.click(SELECTORS.NEXT_BUTTON);
    } else if (await page.isVisible(SELECTORS.CONTINUE_BUTTON)) {
      await page.click(SELECTORS.CONTINUE_BUTTON);
    } else {
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(2000);
  }
}

/**
 * Enter OTP flow: fills OTP, verifies login with retry loop + cookie fallback,
 * saves storage state. Returns whether login was detected.
 */
export async function enterOtpFlow(
  page: Page,
  context: BrowserContext,
  otp: string,
  storageStatePath: string
): Promise<{ logged_in: boolean }> {
  await debugStep(page, "Waiting for OTP input fields");
  await page.waitForSelector(SELECTORS.OTP_INPUT_GENERIC, { timeout: 30000 });
  const inputs = page.locator(SELECTORS.OTP_INPUT_GENERIC);
  const count = await inputs.count();

  if (count >= 4) {
    await debugStep(page, "Filling 4-digit OTP inputs");
    const otpInputs = page.locator(SELECTORS.OTP_INPUT_NUMERIC);
    const otpCount = await otpInputs.count();
    if (otpCount >= 4) {
      for (let i = 0; i < 4; i++) {
        await otpInputs.nth(i).fill(otp[i]);
        await page.waitForTimeout(100);
      }
    } else {
      for (let i = 0; i < Math.min(4, count); i++) {
        await inputs.nth(i).fill(otp[i]);
        await page.waitForTimeout(100);
      }
    }
  } else {
    await debugStep(page, "Filling single OTP input");
    const otpInput = page.locator(SELECTORS.OTP_INPUT_NAMED).first();
    if (await otpInput.isVisible().catch(() => false)) {
      await otpInput.fill(otp);
    } else {
      await page.fill(SELECTORS.OTP_INPUT_GENERIC, otp);
    }
  }

  await debugStep(page, "Submitting OTP");
  await page.keyboard.press("Enter");

  // Wait for page to react to OTP submission
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  // Retry checkLoggedIn with delays -- the page may be in transition
  // (success animation, location popup, redirect) right after OTP
  let loggedIn = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    loggedIn = await checkLoggedIn(page);
    if (loggedIn) break;
    log(`Login check attempt ${attempt + 1}/5: not detected yet, waiting...`);
    await page.waitForTimeout(2000);
  }

  // Fallback: check if auth cookies exist even if UI indicators aren't visible
  // (e.g., location popup or overlay is blocking "My Account")
  if (!loggedIn) {
    const cookies = await context.cookies("https://blinkit.com");
    const hasAuthCookie = cookies.some(
      (c) => c.name === "gr_1_accessToken" || c.name === "auth_key" || c.name === "access_token" || c.name === "_session_token"
    );
    if (hasAuthCookie) {
      log("UI check failed but auth cookies found -- treating as logged in");
      loggedIn = true;
    }
  }

  log(`OTP verification: loggedIn=${loggedIn}`);

  // Always save storage state after OTP -- even if we can't confirm login,
  // the cookies may still be valid
  try {
    const { existsSync, mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    const dir = dirname(storageStatePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    await context.storageState({ path: storageStatePath });
    log(`Session saved to ${storageStatePath}`);
  } catch (e) {
    log(`Failed to save storage state: ${e}`);
  }

  return { logged_in: loggedIn };
}
