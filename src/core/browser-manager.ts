import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { homedir } from "os";
import type { BridgeCommand, BridgeResponse } from "../types.ts";
import type { Logger } from "./logger.ts";
import type { BlinkitConfig } from "../config/schema.ts";
import type { SessionManager } from "./session-manager.ts";
import { TIMEOUTS, CONFIG_DIR, COOKIES_DIR, STORAGE_STATE_FILE } from "../constants.ts";

export class BrowserManager {
  private process: ChildProcess | null = null;
  private pending = new Map<string, {
    resolve: (value: BridgeResponse) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private logger: Logger;
  private config: BlinkitConfig;
  private sessionManager: SessionManager | null = null;
  private buffer = "";
  private started = false;

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

  async ensureReady(): Promise<void> {
    if (!this.started || !this.process) {
      this.logger.info("Bridge not running, starting...");
      await this.start();
      return;
    }
    // Health check — send isAlive command with short timeout
    try {
      const result = await this.sendCommandRaw("isAlive", {}, 5000);
      if (!result.success) {
        throw new Error("Browser bridge health check failed. The bridge process may be in a bad state.");
      }
    } catch {
      this.logger.warn("Bridge health check failed, restarting...");
      await this.close();
      await this.start();
    }
  }

  private sendCommandRaw(action: string, params: Record<string, unknown> = {}, timeout = TIMEOUTS.BRIDGE_COMMAND): Promise<BridgeResponse> {
    if (!this.process || !this.started) {
      return Promise.reject(new Error("Browser bridge is not running. The MCP server may need to be restarted."));
    }
    const id = crypto.randomUUID();
    const command: BridgeCommand = { id, action, params };
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command '${action}' timed out after ${timeout}ms. The browser may be unresponsive — try restarting the MCP server.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const json = JSON.stringify(command) + "\n";
      this.process!.stdin!.write(json);
    });
  }

  private getProjectRoot(): string {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    // From src/core/ -> project root is ../../
    // From dist/ -> project root is ../
    const srcRoot = join(thisDir, "..", "..");
    if (existsSync(join(srcRoot, "package.json"))) return srcRoot;
    const distRoot = join(thisDir, "..");
    if (existsSync(join(distRoot, "package.json"))) return distRoot;
    return srcRoot;
  }

  private getBridgePath(): string {
    const root = this.getProjectRoot();
    // Check scripts/ first (dev mode), then dist/ (built mode)
    const devPath = join(root, "scripts", "playwright-bridge.ts");
    if (existsSync(devPath)) return devPath;
    const distPath = join(root, "dist", "playwright-bridge.ts");
    if (existsSync(distPath)) return distPath;
    return devPath; // fallback
  }

  private getTsxPath(): string {
    const root = this.getProjectRoot();
    // Use local tsx binary from node_modules
    const localTsx = join(root, "node_modules", ".bin", "tsx");
    if (existsSync(localTsx)) return localTsx;
    // Fallback to npx
    return "npx";
  }

  async start(): Promise<void> {
    if (this.started && this.process) return;

    const bridgePath = this.getBridgePath();
    const tsxPath = this.getTsxPath();
    const projectRoot = this.getProjectRoot();
    this.logger.info(`Starting Playwright bridge: ${tsxPath} ${bridgePath}`);

    const args = tsxPath.endsWith("npx") ? ["tsx", bridgePath] : [bridgePath];

    // debug mode implies headed (headless=false)
    const headless = this.config.debug ? false : this.config.headless;

    this.process = spawn(tsxPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: projectRoot,
      env: {
        ...process.env,
        BLINKIT_HEADLESS: String(headless),
      },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line) as BridgeResponse;
          const pending = this.pending.get(response.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(response.id);
            pending.resolve(response);
          }
        } catch {
          this.logger.debug(`Bridge stdout (non-JSON): ${line}`);
        }
      }
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.logger.debug(`Bridge stderr: ${chunk.toString().trim()}`);
    });

    this.process.on("exit", (code) => {
      this.logger.warn(`Playwright bridge exited with code ${code}`);
      this.started = false;
      this.process = null;
      // Reject all pending
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Browser bridge process crashed unexpectedly (exit code ${code}). Try restarting the MCP server.`));
        this.pending.delete(id);
      }
    });

    this.started = true;

    // Wait for bridge to be ready by sending init command with session data
    const session = this.sessionManager?.getSession();
    const initResult = await this.sendCommand("init", {
      headless,
      debug: this.config.debug,
      slowMo: this.config.debug ? (this.config.slow_mo || 500) : this.config.slow_mo,
      lat: session?.lat ?? this.config.default_lat ?? 28.6139,
      lon: session?.lon ?? this.config.default_lon ?? 77.209,
      storageStatePath: this.getStorageStatePath(),
    });
    if (!initResult.success) {
      throw new Error(`Browser bridge initialization failed: ${initResult.error}. Make sure Playwright browsers are installed (npx playwright install chromium).`);
    }
    this.logger.info("Playwright bridge initialized");
  }

  async sendCommand(action: string, params: Record<string, unknown> = {}): Promise<BridgeResponse> {
    await this.ensureReady();

    const id = crypto.randomUUID();
    const command: BridgeCommand = { id, action, params };

    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge command '${action}' timed out after ${TIMEOUTS.BRIDGE_COMMAND}ms. The browser may be unresponsive — try restarting the MCP server.`));
      }, TIMEOUTS.BRIDGE_COMMAND);

      this.pending.set(id, { resolve, reject, timer });

      const json = JSON.stringify(command) + "\n";
      this.process!.stdin!.write(json);
    });
  }

  async close(): Promise<void> {
    if (this.process) {
      try {
        await this.sendCommand("close", {});
      } catch {
        // Ignore errors during close
      }
      this.process.kill();
      this.process = null;
      this.started = false;
    }
  }

  isRunning(): boolean {
    return this.started && this.process !== null;
  }
}
