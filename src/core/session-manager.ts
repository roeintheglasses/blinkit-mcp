import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { CONFIG_DIR, AUTH_FILE } from "../constants.js";
import type { SessionData } from "../types.js";
import type { Logger } from "./logger.js";

function getAuthPath(): string {
  return join(homedir(), CONFIG_DIR, AUTH_FILE);
}

function ensureConfigDir(): void {
  const dir = join(homedir(), CONFIG_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

const DEFAULT_SESSION: SessionData = {
  phone: null,
  lat: null,
  lon: null,
  logged_in: false,
};

export class SessionManager {
  private session: SessionData;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.session = { ...DEFAULT_SESSION };
  }

  load(): SessionData {
    const path = getAuthPath();
    if (!existsSync(path)) {
      this.logger.debug("No auth file found, using default session");
      return this.session;
    }
    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw) as Partial<SessionData>;
      this.session = { ...DEFAULT_SESSION, ...data };
      this.logger.info("Session loaded from disk");
    } catch (e) {
      this.logger.warn("Failed to load auth file, using default session", e);
      this.session = { ...DEFAULT_SESSION };
    }
    return this.session;
  }

  save(): void {
    ensureConfigDir();
    const path = getAuthPath();
    writeFileSync(path, JSON.stringify(this.session, null, 2), "utf-8");
    chmodSync(path, 0o600);
    this.logger.info("Session saved to disk");
  }

  clear(): void {
    const path = getAuthPath();
    if (existsSync(path)) {
      unlinkSync(path);
    }
    this.session = { ...DEFAULT_SESSION };
    this.logger.info("Session cleared");
  }

  isAuthenticated(): boolean {
    return this.session.logged_in;
  }

  getSession(): SessionData {
    return this.session;
  }

  setLocation(lat: number, lon: number): void {
    this.session.lat = lat;
    this.session.lon = lon;
    this.save();
  }

  setLoggedIn(loggedIn: boolean, phone?: string): void {
    this.session.logged_in = loggedIn;
    if (phone !== undefined) this.session.phone = phone;
    this.save();
  }

  getPhone(): string | null {
    return this.session.phone;
  }
}
