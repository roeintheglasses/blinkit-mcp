import type { Page } from "playwright";
import { SELECTORS } from "./selectors.ts";
import QRCode from "qrcode";

function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}

// ─── Payment iframe helpers ──────────────────────────────────────────────────

/**
 * Get the payment iframe's content frame.
 * Returns null if iframe not found or not accessible.
 */
export async function getPaymentFrame(page: Page, timeoutMs = 15000) {
  const iframeElement = await page.waitForSelector(SELECTORS.PAYMENT_WIDGET, { timeout: timeoutMs }).catch(() => null);
  if (!iframeElement) return null;
  const frame = await iframeElement.contentFrame();
  if (!frame) return null;
  await frame.waitForLoadState("domcontentloaded").catch(() => {});
  return frame;
}

/**
 * Try to extract the UPI URL directly from the payment iframe DOM.
 * Searches data attributes, anchor hrefs, and JS variables for upi:// URLs.
 */
export async function extractUpiUrl(frame: import("playwright").Frame): Promise<string | null> {
  try {
    const upiUrl = await frame.evaluate(`(() => {
      const allElements = document.querySelectorAll("*");
      for (const el of allElements) {
        for (const attr of el.attributes) {
          if (attr.value.includes("upi://")) {
            const m = attr.value.match(/upi:\\/\\/[^\\s"'<>]+/);
            return m ? m[0] : null;
          }
          if (attr.value.includes("upi%3A%2F%2F")) {
            const decoded = decodeURIComponent(attr.value);
            const m = decoded.match(/upi:\\/\\/[^\\s"'<>]+/);
            return m ? m[0] : null;
          }
        }
        if (el.children.length === 0 && el.textContent && el.textContent.includes("upi://")) {
          const m = el.textContent.match(/upi:\\/\\/[^\\s"'<>]+/);
          return m ? m[0] : null;
        }
      }
      const links = document.querySelectorAll("a[href]");
      for (const link of links) {
        const href = link.href;
        if (href && href.includes("upi://")) {
          const m = href.match(/upi:\\/\\/[^\\s"'<>]+/);
          return m ? m[0] : null;
        }
      }
      return null;
    })()`) as string | null;

    if (upiUrl) {
      log(`Extracted UPI URL from DOM: ${upiUrl.substring(0, 80)}...`);
    }
    return upiUrl;
  } catch (e) {
    log(`UPI URL extraction from DOM failed: ${e}`);
    return null;
  }
}

/**
 * Decode a QR code PNG buffer to extract the encoded data string.
 * Uses pngjs + @paulmillr/qr (dynamically imported).
 * This is a fallback when DOM extraction fails.
 */
export async function decodeQrFromPng(pngBuffer: Buffer): Promise<string | null> {
  try {
    const { PNG } = await import("pngjs");
    const { default: decodeQR } = await import("@paulmillr/qr/decode.js");
    const png = PNG.sync.read(pngBuffer);
    const data = decodeQR({
      height: png.height,
      width: png.width,
      data: new Uint8Array(png.data),
    });
    if (data) log(`Decoded QR data from image: ${data.substring(0, 80)}...`);
    return data ?? null;
  } catch (e) {
    log(`QR image decode failed: ${e}`);
    return null;
  }
}

/**
 * Capture the UPI QR code image from the payment iframe.
 * Saves to a local file, returns base64 for inline display,
 * and generates a Unicode text representation for clients that don't support images.
 *
 * Text art generation strategy:
 *   1. Try extracting UPI URL directly from iframe DOM (no extra deps needed)
 *   2. Fall back to decoding QR image with pngjs + @paulmillr/qr
 *   3. Re-render the URL as a compact Unicode text QR with the qrcode package
 */
export async function captureQrCode(frame: import("playwright").Frame): Promise<{
  base64: string;
  filePath: string;
  textArt: string | null;
} | null> {
  let base64: string | null = null;
  let pngBuffer: Buffer | null = null;

  try {
    // Capture the QR image ---

    // Strategy 1: Screenshot the QR wrapper container
    const qrWrapper = frame.locator(SELECTORS.QR_WRAPPER).first();
    if (await qrWrapper.count() > 0 && await qrWrapper.isVisible().catch(() => false)) {
      pngBuffer = await qrWrapper.screenshot() as Buffer;
      base64 = pngBuffer.toString("base64");
      log("Captured QR code via element screenshot");
    }

    // Strategy 2: Extract the base64 data URL from the QR image element
    if (!base64) {
      const qrDataImg = frame.locator(SELECTORS.QR_DATA_IMAGE).first();
      if (await qrDataImg.count() > 0) {
        const src = await qrDataImg.getAttribute("src");
        if (src && src.startsWith("data:image/png;base64,")) {
          base64 = src.replace("data:image/png;base64,", "");
          pngBuffer = Buffer.from(base64, "base64");
          log("Captured QR code via data URL extraction");
        }
      }
    }

    // Strategy 3: Screenshot any visible canvas
    if (!base64) {
      const canvas = frame.locator(SELECTORS.CANVAS).first();
      if (await canvas.count() > 0 && await canvas.isVisible().catch(() => false)) {
        pngBuffer = await canvas.screenshot() as Buffer;
        base64 = pngBuffer.toString("base64");
        log("Captured QR code via canvas screenshot");
      }
    }

    if (!base64 || !pngBuffer) {
      log("Could not find QR code element to capture");
      return null;
    }

    // Save to local file
    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const dir = join(homedir(), ".blinkit-mcp");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filePath = join(dir, "upi-qr-code.png");
    writeFileSync(filePath, pngBuffer);
    log(`QR code saved to ${filePath}`);

    // Generate text art QR ---

    // First try: extract UPI URL directly from iframe DOM (no decode deps needed)
    let qrData = await extractUpiUrl(frame);

    // Fallback: decode the QR image to extract the URL
    if (!qrData) {
      log("DOM extraction failed, falling back to QR image decode...");
      qrData = await decodeQrFromPng(pngBuffer);
    }

    let textArt: string | null = null;
    if (qrData) {
      try {
        textArt = await QRCode.toString(qrData, { type: "utf8" });
      } catch (e) {
        log(`QR text re-render failed: ${e}`);
      }
    }

    return { base64, filePath, textArt };
  } catch (e) {
    log(`QR capture failed: ${e}`);
    return null;
  }
}
