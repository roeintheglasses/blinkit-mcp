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

function parseNum(val: string | undefined): number | undefined {
  if (!val || val.startsWith("$")) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}

function loadEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const env = process.env;

  const lat = parseNum(env.BLINKIT_DEFAULT_LAT);
  if (lat !== undefined) overrides.default_lat = lat;
  const lon = parseNum(env.BLINKIT_DEFAULT_LON);
  if (lon !== undefined) overrides.default_lon = lon;
  const warn = parseNum(env.BLINKIT_WARN_THRESHOLD);
  if (warn !== undefined) overrides.warn_threshold = warn;
  const max = parseNum(env.BLINKIT_MAX_ORDER_AMOUNT);
  if (max !== undefined) overrides.max_order_amount = max;
  if (env.BLINKIT_HEADLESS && !env.BLINKIT_HEADLESS.startsWith("$")) overrides.headless = env.BLINKIT_HEADLESS !== "false";
  if (env.BLINKIT_DEBUG && !env.BLINKIT_DEBUG.startsWith("$")) overrides.debug = env.BLINKIT_DEBUG === "true";
  const slowMo = parseNum(env.BLINKIT_SLOW_MO);
  if (slowMo !== undefined) overrides.slow_mo = slowMo;
  if (env.BLINKIT_SCREENSHOT_ON_ERROR && !env.BLINKIT_SCREENSHOT_ON_ERROR.startsWith("$")) overrides.screenshot_on_error = env.BLINKIT_SCREENSHOT_ON_ERROR !== "false";
  return overrides;
}

export function loadConfig(): BlinkitConfig {
  const fileConfig = loadFileConfig();
  const envOverrides = loadEnvOverrides();
  const merged = { ...fileConfig, ...envOverrides };
  return ConfigSchema.parse(merged);
}
