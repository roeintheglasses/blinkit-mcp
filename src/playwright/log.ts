/** Shared logging utility for Playwright flows */
export function log(msg: string): void {
  process.stderr.write(`[playwright] ${msg}\n`);
}
