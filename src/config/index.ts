import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ConfigSchema, type BlinkitConfig } from "./schema.js";
import { CONFIG_DIR, CONFIG_FILE } from "../constants.js";

function getConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE);
}

function loadFileConfig(): Record<string, unknown> {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function loadEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const env = process.env;

  if (env.BLINKIT_DEFAULT_LAT) overrides.default_lat = Number(env.BLINKIT_DEFAULT_LAT);
  if (env.BLINKIT_DEFAULT_LON) overrides.default_lon = Number(env.BLINKIT_DEFAULT_LON);
  if (env.BLINKIT_WARN_THRESHOLD) overrides.warn_threshold = Number(env.BLINKIT_WARN_THRESHOLD);
  if (env.BLINKIT_MAX_ORDER_AMOUNT) overrides.max_order_amount = Number(env.BLINKIT_MAX_ORDER_AMOUNT);
  if (env.BLINKIT_HEADLESS) overrides.headless = env.BLINKIT_HEADLESS !== "false";
  if (env.BLINKIT_DEBUG) overrides.debug = env.BLINKIT_DEBUG === "true";
  if (env.BLINKIT_SLOW_MO) overrides.slow_mo = Number(env.BLINKIT_SLOW_MO);
  if (env.BLINKIT_SCREENSHOT_ON_ERROR) overrides.screenshot_on_error = env.BLINKIT_SCREENSHOT_ON_ERROR !== "false";
  return overrides;
}

export function loadConfig(): BlinkitConfig {
  const fileConfig = loadFileConfig();
  const envOverrides = loadEnvOverrides();
  const merged = { ...fileConfig, ...envOverrides };
  return ConfigSchema.parse(merged);
}
