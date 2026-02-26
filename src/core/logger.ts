export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: number;

  constructor(level: LogLevel = "info") {
    this.level = LOG_LEVELS[level];
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < this.level) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    // CRITICAL: use console.error (stderr) to avoid corrupting JSON-RPC stdio stream
    if (data !== undefined) {
      console.error(`${prefix} ${message}`, data);
    } else {
      console.error(`${prefix} ${message}`);
    }
  }

  debug(message: string, data?: unknown): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.log("error", message, data);
  }
}
