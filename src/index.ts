#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/index.js";
import { Logger } from "./core/logger.js";
import { SessionManager } from "./core/session-manager.js";
import { RateLimiter } from "./core/rate-limiter.js";
import { BrowserManager } from "./core/browser-manager.js";
import { BlinkitHttpClient } from "./core/http-client.js";
import { SpendingGuard } from "./services/spending-guard.js";
import { createServer } from "./server.js";
import { getLocationFromIP } from "./utils/geo.js";
import type { AppContext } from "./types.js";

async function main() {
  const logger = new Logger("info");
  logger.info("Starting Blinkit MCP server...");

  // Load config
  const config = loadConfig();
  logger.info("Config loaded", {
    headless: config.headless,
    warn_threshold: config.warn_threshold,
    max_order_amount: config.max_order_amount,
  });

  // Initialize core modules
  const sessionManager = new SessionManager(logger);
  sessionManager.load();

  // Detect location: try IP geolocation first, then config defaults
  if (sessionManager.getSession().lat === null) {
    try {
      const ipLocation = await getLocationFromIP();
      if (ipLocation) {
        logger.info(`Using IP-detected location: ${ipLocation.latitude}, ${ipLocation.longitude}`);
        sessionManager.setLocation(ipLocation.latitude, ipLocation.longitude);
      } else if (config.default_lat !== undefined && config.default_lon !== undefined) {
        logger.info("IP detection failed, using config defaults");
        sessionManager.setLocation(config.default_lat, config.default_lon);
      }
    } catch {
      if (config.default_lat !== undefined && config.default_lon !== undefined) {
        sessionManager.setLocation(config.default_lat, config.default_lon);
      }
    }
  }

  const rateLimiter = new RateLimiter();
  const httpClient = new BlinkitHttpClient(rateLimiter, logger);
  const browserManager = new BrowserManager(logger, config);
  browserManager.setSessionManager(sessionManager);
  const spendingGuard = new SpendingGuard(config);

  // Build app context
  const ctx: AppContext = {
    config,
    httpClient,
    browserManager,
    sessionManager,
    rateLimiter,
    spendingGuard,
    logger,
  };

  // Create MCP server with all tools
  const server = createServer(ctx);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Blinkit MCP server running on stdio");

  // Cleanup on exit
  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    await browserManager.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Shutting down...");
    await browserManager.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
