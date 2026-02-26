---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

# Blinkit MCP Server

MCP (Model Context Protocol) server for Blinkit, India's quick-commerce grocery delivery platform. Enables AI assistants to search products, manage carts, and place orders on behalf of users.

## Runtime & Tooling

Default to using **Bun** instead of Node.js.

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` instead of `jest` or `vitest`
- `bun build` instead of `webpack` or `esbuild`
- `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- `bunx <package>` instead of `npx <package>`
- Bun automatically loads `.env` — don't use `dotenv`

**Exception:** The Playwright bridge (`scripts/playwright-bridge.ts`) runs under Node.js via `tsx` because Playwright has known incompatibilities with Bun (segfaults, child process issues). Never attempt to run the bridge with Bun.

## Project Scripts

```sh
bun run dev        # Start MCP server in dev mode (bun run src/index.ts)
bun run build      # Build to ./dist/ and copy bridge script
bun test           # Run all unit tests
```

## Architecture Overview

```
MCP Client (Claude Desktop / Claude Code / etc.)
    │ JSON-RPC over stdio
    ▼
┌──────────────────────────────────────┐
│  MCP Server  (Bun runtime)           │
│  src/index.ts → src/server.ts        │
└──────────┬───────────────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
 Tools        Services        Core
 (thin     (business      (infrastructure)
 wrappers)  logic)
    │             │              │
    │        ┌────┴────┐        │
    │        ▼         ▼        │
    │   HTTP Client  Browser    │
    │   (direct API) Manager    │
    │        │         │        │
    ▼        ▼         ▼        │
      Blinkit API    Playwright │
                     Bridge     │
                  (Node.js      │
                   subprocess)  │
                       │        │
                    Firefox     │
```

### 4-Layer Architecture

1. **Tools** (`src/tools/`) — Thin MCP tool definitions. Validate input with Zod, delegate to services, return `{ content: [{ type: "text", text }] }`.
2. **Services** (`src/services/`) — Business logic. Pattern: **try HTTP first, fall back to Playwright** if the direct API fails.
3. **Core** (`src/core/`) — Infrastructure: HTTP client, browser manager, session persistence, rate limiter, logger.
4. **Bridge** (`scripts/playwright-bridge.ts`) — Separate Node.js subprocess for Playwright automation, communicates via JSON-over-stdio with BrowserManager.

## Directory Structure

```
src/
├── index.ts                    # Entry point — initializes context, connects stdio transport
├── server.ts                   # MCP server setup, registers all 22 tools
├── types.ts                    # Shared interfaces (Product, Cart, Order, AppContext, etc.)
├── constants.ts                # API endpoints, rate limits, timeouts, header defaults
├── config/
│   ├── index.ts                # Config loading from file (~/.blinkit-mcp/config.json) + env vars
│   └── schema.ts               # Zod schema for BlinkitConfig
├── core/
│   ├── logger.ts               # Structured stderr-only logging (never stdout)
│   ├── session-manager.ts      # Auth state & location persistence to ~/.blinkit-mcp/auth.json
│   ├── http-client.ts          # Blinkit HTTP API wrapper with timeouts & error handling
│   ├── rate-limiter.ts         # Token-bucket (5 tokens, 2/sec refill, 200ms min interval)
│   └── browser-manager.ts      # Spawns & manages Playwright bridge subprocess via IPC
├── services/
│   ├── product-service.ts      # Search, product details, category browsing
│   ├── cart-service.ts         # Cart CRUD with spending guard checks
│   ├── auth-service.ts         # Login flow, OTP verification, session reuse
│   ├── location-service.ts     # IP geolocation, manual location, saved addresses
│   ├── order-service.ts        # Checkout, order history, tracking
│   ├── payment-service.ts      # UPI ID management & payment execution
│   └── spending-guard.ts       # Enforces warn_threshold and max_order_amount limits
├── tools/
│   ├── auth/                   # 4 tools: check_login_status, login, enter_otp, logout
│   ├── location/               # 3 tools: set_location, get_saved_addresses, select_address
│   ├── browse/                 # 4 tools: search_products, get_product_details, browse_categories, browse_category
│   ├── cart/                   # 5 tools: get_cart, add_to_cart, update_cart_item, remove_from_cart, clear_cart
│   └── orders/                 # 6 tools: checkout, get_order_history, track_order, get_upi_ids, select_upi_id, pay_now
├── utils/
│   └── geo.ts                  # IP-based geolocation helper
└── playwright/                 # Centralized selectors and flow helpers for browser automation
    └── selectors.ts            # CSS selectors for Blinkit UI elements
scripts/
└── playwright-bridge.ts        # Node.js subprocess for Playwright (23 commands, ~1700 lines)
test/
├── unit/
│   ├── session-manager.test.ts
│   ├── rate-limiter.test.ts
│   ├── spending-guard.test.ts
│   └── config.test.ts
└── mocks/
    └── blinkit-api.ts          # Shared mock data for tests
```

## Key Conventions

### Logging — NEVER use `console.log`

The MCP server communicates via JSON-RPC over stdout. Any `console.log` call will corrupt the protocol stream and crash the connection. Always use `ctx.logger.*` (which writes to stderr via `console.error`).

```ts
// WRONG — breaks JSON-RPC
console.log("debug info");

// CORRECT
ctx.logger.info("debug info");
ctx.logger.debug("verbose info", { someData });
```

### Tool Definition Pattern

Every tool follows this structure in `src/tools/<domain>/<tool-name>.ts`:

```ts
import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { SomeService } from "../../services/some-service.ts";

export const myTool = {
  name: "my_tool",
  description: "What this tool does",
  inputSchema: {
    param1: z.string().min(1),
    param2: z.number().optional(),
  },
  handler: async (input: { param1: string; param2?: number }, ctx: AppContext) => {
    const service = new SomeService(ctx);
    const result = await service.doSomething(input.param1);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
};
```

After creating a new tool, register it in `src/server.ts` by importing it and adding it to the `ALL_TOOLS` array.

### Service Pattern — HTTP First, Playwright Fallback

Services should attempt direct HTTP API calls first and only fall back to the Playwright bridge when the HTTP approach fails or isn't available for that operation:

```ts
async search(query: string): Promise<SearchResult> {
  try {
    return await this.searchViaHttp(query);
  } catch {
    this.ctx.logger.warn("HTTP search failed, falling back to browser");
    return await this.searchViaBrowser(query);
  }
}
```

### Input Validation

All external input is validated at the tool boundary using Zod schemas defined inline in the tool's `inputSchema`. Services trust their inputs since they come from validated tool handlers.

### Error Handling

- Services throw descriptive `Error` messages with user-facing troubleshooting hints
- `src/server.ts` wraps all tool handlers in try/catch, returning errors as `{ content: [...], isError: true }`
- Include actionable guidance in error messages (e.g., "Try logging in first with the login tool")

### Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `product-service.ts`, `search-products.ts` |
| MCP tool names | snake_case | `search_products`, `add_to_cart` |
| Tool exports | camelCase with `Tool` suffix | `searchProductsTool` |
| Services | PascalCase with `Service` suffix | `ProductService` |
| Interfaces/Types | PascalCase | `Product`, `CartItem`, `AppContext` |

### TypeScript

- Strict mode enabled (`strict: true` in tsconfig)
- Target: ESNext, Module: Preserve (Bun native)
- Use `unknown` instead of `any`
- Use `import type` for type-only imports (`verbatimModuleSyntax: true`)
- Shared types live in `src/types.ts`

### Dependencies — Keep Minimal

This project has only 2 runtime dependencies:
- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` — Input validation

Do not add dependencies for things Bun provides natively. Do not add Express, dotenv, or other redundant packages.

## Configuration

Config is loaded from `~/.blinkit-mcp/config.json` with env var overrides:

| Option | Env Var | Type | Default | Description |
|--------|---------|------|---------|-------------|
| `default_lat` | `BLINKIT_DEFAULT_LAT` | number | — | Fallback delivery latitude |
| `default_lon` | `BLINKIT_DEFAULT_LON` | number | — | Fallback delivery longitude |
| `warn_threshold` | `BLINKIT_WARN_THRESHOLD` | number | 500 | Spending warning threshold (INR) |
| `max_order_amount` | `BLINKIT_MAX_ORDER_AMOUNT` | number | 2000 | Hard checkout limit (INR) |
| `headless` | `BLINKIT_HEADLESS` | boolean | true | Playwright headless mode |
| `debug` | `BLINKIT_DEBUG` | boolean | false | Debug logging (forces headed mode) |
| `slow_mo` | `BLINKIT_SLOW_MO` | number | 0 | Playwright slow motion (ms) |
| `playwright_mode` | `BLINKIT_PLAYWRIGHT_MODE` | "bridge" \| "direct" | "bridge" | Bridge = Node.js subprocess |

Session state is persisted to `~/.blinkit-mcp/auth.json`.

## Testing

Tests use `bun:test` (Bun's built-in test runner). Run with:

```sh
bun test
```

Test files live in `test/unit/` and follow this pattern:

```ts
import { describe, test, expect } from "bun:test";

describe("MyModule", () => {
  test("does something", () => {
    expect(result).toBe(expected);
  });
});
```

**Mock strategy:**
- Mock `BrowserManager.sendCommand` and `HttpClient.get/post` with `mock()`
- Build a mock `AppContext` for service tests
- Shared mock data lives in `test/mocks/blinkit-api.ts`
- Tests focus on in-memory behavior (no network or filesystem side effects)

When adding new features, add corresponding unit tests in `test/unit/`.

## Bun API Preferences

- `Bun.serve()` for HTTP servers (supports WebSockets, HTTPS, routes). Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile.
- `Bun.$\`ls\`` instead of `execa`.

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Playwright Bridge Protocol

The bridge (`scripts/playwright-bridge.ts`) communicates with `BrowserManager` via JSON messages over stdin/stdout of the Node.js subprocess:

**Request format:** `{ id: string, action: string, params: Record<string, unknown> }`
**Response format:** `{ id: string, success: boolean, data?: unknown, error?: string }`

The bridge supports 23 commands: `init`, `isAlive`, `close`, `isLoggedIn`, `saveSession`, `login`, `enterOtp`, `search`, `getProductDetails`, `browseCategories`, `browseCategory`, `addToCart`, `getCart`, `updateCartItem`, `removeFromCart`, `clearCart`, `setLocation`, `getAddresses`, `selectAddress`, `checkout`, `getUpiIds`, `selectUpiId`, `payNow`, `getOrders`, `trackOrder`.

When updating selectors for Blinkit's UI, update `src/playwright/selectors.ts` (centralized) and the corresponding sections in `scripts/playwright-bridge.ts`.
