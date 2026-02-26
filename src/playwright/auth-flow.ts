import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import { waitAndClick, waitAndFill } from "./helpers.ts";
import { BLINKIT_BASE_URL } from "../constants.ts";

export async function loginFlow(page: Page, phoneNumber: string): Promise<void> {
  await page.goto(BLINKIT_BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Click the Login button
  await waitAndClick(page, SELECTORS.LOGIN_BUTTON, 15000);
  await page.waitForTimeout(1000);

  // Fill phone number
  const phoneInput = page.locator(SELECTORS.PHONE_INPUT).first();
  await phoneInput.waitFor({ timeout: 10000 });
  await phoneInput.fill(phoneNumber);
  await page.waitForTimeout(500);

  // Click Continue to send OTP
  await waitAndClick(page, SELECTORS.CONTINUE_BUTTON, 5000);
  await page.waitForTimeout(2000);
}

export async function enterOtpFlow(page: Page, otp: string): Promise<{
  logged_in: boolean;
}> {
  // Fill OTP digits into the inputs
  const otpInputs = page.locator(SELECTORS.OTP_FIRST_INPUT);
  const count = await otpInputs.count();

  if (count >= 4) {
    // Individual digit inputs
    for (let i = 0; i < 4; i++) {
      await otpInputs.nth(i).fill(otp[i]);
      await page.waitForTimeout(200);
    }
  } else {
    // Single OTP input
    const singleInput = page.locator(SELECTORS.OTP_INPUTS).first();
    await singleInput.fill(otp);
  }

  // Wait for login to complete (page navigation or session established)
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  // Check if login succeeded by looking for logged-in indicators
  const allCookies = await page.context().cookies();
  const hasCookies = allCookies.length > 0;
  const hasAccessToken = allCookies.some(c => c.name === "access_token") ||
    await page.evaluate(() => !!localStorage.getItem("access_token")).catch(() => false);

  const logged_in = hasCookies && hasAccessToken;

  return { logged_in };
}
