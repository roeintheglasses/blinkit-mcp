# Contributing to blinkit-mcp

This guide covers everything you need to contribute to the blinkit-mcp project: a Model Context Protocol (MCP) server that enables AI assistants to interact with Blinkit for grocery delivery.

## Table of Contents

- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [Adding a New Tool](#adding-a-new-tool)
- [Bridge Command Protocol](#bridge-command-protocol)
- [Updating Selectors](#updating-selectors)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest stable)
- Node.js (required by the Playwright bridge -- see [Architecture Overview](#architecture-overview))
- Git

### Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/blinkit-mcp.git
   cd blinkit-mcp
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Install Playwright's Firefox browser (the only browser this project uses):

   ```bash
   npx playwright install firefox
   ```

4. Run the test suite to verify everything works:

   ```bash
   bun test
   ```

---

## Architecture Overview

The codebase is organized into four layers. Understanding this structure is essential before making changes.

```
MCP Client (Claude, etc.)
    |
    v
+--------------------------+
| Tools Layer              |  src/tools/<category>/*.ts
| Zod validation, MCP      |
| response formatting       |
+--------------------------+
    |
    v
+--------------------------+
| Services Layer           |  src/services/*.ts
| Business logic, decides   |
| HTTP vs Playwright        |
+--------------------------+
    |            |
    v            v
+----------+  +----------------+
| HTTP     |  | Browser        |
| Client   |  | Manager        |
+----------+  +----------------+
  src/core/     src/core/
  http-client   browser-manager
    |                |
    v                | JSON-over-stdio IPC
  Blinkit API        v
               +---------------------+
               | Playwright Bridge   |
               | (separate Node.js   |
               |  process)           |
               +---------------------+
                 scripts/playwright-bridge.ts
```

### Layer 1: Tools (`src/tools/`)

Each file exports a tool definition with four parts: `name`, `description`, `inputSchema` (Zod), and `handler`. Tools are organized by domain:

| Directory | Purpose | Examples |
|---|---|---|
| `src/tools/auth/` | Authentication | `login`, `enter_otp`, `check_login_status`, `logout` |
| `src/tools/location/` | Location and address management | `set_location`, `get_saved_addresses`, `select_address` |
| `src/tools/browse/` | Product discovery | `search_products`, `get_product_details`, `browse_categories`, `browse_category` |
| `src/tools/cart/` | Cart operations | `get_cart`, `add_to_cart`, `update_cart_item`, `remove_from_cart`, `clear_cart` |
| `src/tools/orders/` | Checkout and order tracking | `checkout`, `get_order_history`, `track_order`, `get_upi_ids`, `select_upi_id`, `pay_now` |

Tools do not contain business logic. They validate input, delegate to a service, and format the response for the MCP protocol.

### Layer 2: Services (`src/services/`)

Services contain the actual business logic. Each service receives `AppContext` and uses it to access the HTTP client, browser manager, session, and other core components.

A key pattern: services attempt the HTTP API first and fall back to Playwright browser automation if the API call fails. See `ProductService.search()` for a clear example of this pattern.

Current services:

- `product-service.ts` -- search, product details, categories
- `cart-service.ts` -- cart CRUD operations
- `auth-service.ts` -- login, OTP verification, session management
- `location-service.ts` -- location setting, address retrieval
- `order-service.ts` -- checkout, order history, tracking
- `payment-service.ts` -- UPI ID management, payment execution
- `spending-guard.ts` -- spending limit enforcement

### Layer 3: Core (`src/core/`)

Low-level infrastructure shared across all services:

- `http-client.ts` -- typed HTTP client for Blinkit's REST API
- `browser-manager.ts` -- spawns and communicates with the Playwright bridge process
- `session-manager.ts` -- tracks authentication state, phone number, and location coordinates
- `rate-limiter.ts` -- token-bucket rate limiter to prevent API abuse
- `logger.ts` -- structured logging to stderr (never stdout)

### Layer 4: Playwright Bridge (`scripts/playwright-bridge.ts`)

A standalone Node.js process that runs Playwright. The main MCP server (running on Bun) communicates with it via JSON messages over stdin/stdout.

**Why a separate process?** Playwright has known incompatibilities with Bun, including segfaults and child process issues. Running the bridge as a separate Node.js process (via `tsx`) avoids these problems entirely. The `BrowserManager` class in `src/core/browser-manager.ts` handles spawning, health-checking, and communicating with this process.

### Shared Types (`src/types.ts`)

All shared interfaces live in `src/types.ts`: `Product`, `Cart`, `CartItem`, `Address`, `OrderSummary`, `BridgeCommand`, `BridgeResponse`, `AppContext`, and others. Import from here rather than defining duplicate types.

### Configuration and Constants (`src/constants.ts`)

API endpoints, rate limit parameters, timeouts, and file paths are defined in `src/constants.ts`. Use these constants instead of hardcoding values.

---

## Adding a New Tool

This section walks through adding a new tool end-to-end.

### Step 1: Create the tool file

Create a new file in the appropriate `src/tools/<category>/` directory. Follow the existing pattern:

```typescript
// src/tools/browse/get-deals.ts
import { z } from "zod";
import type { AppContext } from "../../types.ts";
import { ProductService } from "../../services/product-service.ts";

export const getDealsTool = {
  name: "get_deals",
  description: "Get current deals and discounted products on Blinkit.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(10),
  },
  handler: async (input: { limit: number }, ctx: AppContext) => {
    const productService = new ProductService(ctx);
    const deals = await productService.getDeals(input.limit);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(deals, null, 2),
        },
      ],
    };
  },
};
```

Key points:

- Use Zod for input validation. The MCP SDK validates inputs automatically before calling your handler.
- The handler receives the validated input and the `AppContext`.
- Always return `{ content: [{ type: "text", text: string }] }`. Use `isError: true` for error responses (the server wrapper in `src/server.ts` handles uncaught exceptions automatically).

### Step 2: Create or extend a service

If your tool's logic fits an existing service, add a method there. Otherwise, create a new service:

```typescript
// In src/services/product-service.ts (extending existing)
async getDeals(limit = 10): Promise<{ products: Product[] }> {
  // Try HTTP first
  try {
    const result = await this.ctx.httpClient.get<{ ... }>(ENDPOINTS.DEALS);
    if (result.ok && result.data?.products) {
      return { products: result.data.products.slice(0, limit) };
    }
  } catch (e) {
    this.ctx.logger.debug("HTTP deals failed, falling back to Playwright", e);
  }

  // Playwright fallback
  const result = await this.ctx.browserManager.sendCommand("getDeals", { limit });
  if (!result.success) {
    throw new Error(result.error ?? "Failed to get deals");
  }
  return result.data as { products: Product[] };
}
```

Follow the established pattern: attempt HTTP first, fall back to Playwright if needed. Some operations (login, OTP entry, checkout) are Playwright-only because they require full browser interaction.

### Step 3: Add a bridge command (if browser automation is needed)

If your tool requires Playwright, add a new `case` to the `switch` statement in `scripts/playwright-bridge.ts`:

```typescript
case "getDeals": {
  if (!page) {
    respond({ id, success: false, error: "Browser not initialized" });
    break;
  }
  try {
    await page.goto("https://blinkit.com/cn/deals-of-the-day/...");
    // ... scrape products using page selectors ...
    respond({ id, success: true, data: { products } });
  } catch (e: any) {
    respond({ id, success: false, error: e.message });
  }
  break;
}
```

See [Bridge Command Protocol](#bridge-command-protocol) for the full specification.

### Step 4: Register the tool

Import and add your tool to the `ALL_TOOLS` array in `src/server.ts`:

```typescript
import { getDealsTool } from "./tools/browse/get-deals.ts";

const ALL_TOOLS: ToolDef[] = [
  // ... existing tools ...
  getDealsTool,
];
```

The server iterates over `ALL_TOOLS` and registers each one with the MCP SDK. No other registration step is needed.

### Summary: the data flow

```
MCP request
  -> tool handler (validates input with Zod, delegates to service)
    -> service method (tries HTTP, falls back to Playwright)
      -> httpClient.get/post(...)       [direct API call]
      -> browserManager.sendCommand(...) [JSON IPC to bridge]
        -> bridge switch/case            [Playwright automation]
```

---

## Bridge Command Protocol

The Playwright bridge uses a JSON-over-stdio protocol. The `BrowserManager` writes JSON commands to the bridge's stdin, and reads JSON responses from the bridge's stdout.

### Command format

```typescript
interface BridgeCommand {
  id: string;                         // UUID, generated by BrowserManager
  action: string;                     // The command name (e.g., "search", "addToCart")
  params: Record<string, unknown>;    // Command-specific parameters
}
```

### Response format

```typescript
interface BridgeResponse {
  id: string;       // Must match the command's id
  success: boolean;  // true if the operation succeeded
  data?: unknown;    // Result payload (on success)
  error?: string;    // Error message (on failure)
}
```

### Message framing

Each message is a single line of JSON terminated by `\n`. The bridge reads lines from stdin and writes lines to stdout. No length prefix or other framing is used.

### Current commands

The bridge handles the following actions:

| Action | Purpose |
|---|---|
| `init` | Launch browser, set geolocation, load saved session |
| `isAlive` | Health check |
| `isLoggedIn` | Check authentication status |
| `saveSession` | Persist browser storage state to disk |
| `login` | Navigate to login, enter phone number |
| `enterOtp` | Submit OTP code |
| `search` | Search products by query |
| `getProductDetails` | Scrape a product's detail page |
| `browseCategories` | List top-level categories |
| `browseCategory` | List products in a category |
| `addToCart` | Add a product to cart |
| `getCart` | Read current cart contents |
| `updateCartItem` | Change quantity of a cart item |
| `removeFromCart` | Remove a product from cart |
| `clearCart` | Empty the entire cart |
| `setLocation` | Set delivery location by coordinates |
| `getAddresses` | List saved delivery addresses |
| `selectAddress` | Choose a saved address |
| `checkout` | Initiate checkout process |
| `getUpiIds` | List saved UPI payment IDs |
| `selectUpiId` | Choose a UPI ID for payment |
| `payNow` | Confirm and execute payment |
| `getOrders` | List order history |
| `trackOrder` | Get tracking info for an order |
| `close` | Shut down the browser |

### Adding a new command

1. Add a new `case` block in the `switch` statement inside the `rl.on("line", ...)` handler in `scripts/playwright-bridge.ts`.
2. Always call `respond()` with the matching `id` -- both on success and failure. Every command must respond exactly once.
3. Always guard with `if (!page)` for commands that need a browser page.
4. Use `log()` (writes to stderr) for debug output. Never use `console.log` -- it would corrupt the JSON protocol on stdout.

---

## Updating Selectors

This is the most common maintenance task. Blinkit frequently updates their website UI, which breaks CSS selectors used in the Playwright bridge.

### Where selectors live

All CSS selectors are currently inline in `scripts/playwright-bridge.ts`, within the individual `case` blocks. There is no centralized selector registry (yet). Search for `page.locator(`, `page.waitForSelector(`, and `querySelector` to find them.

### How to identify broken selectors

Symptoms:

- A tool that previously worked starts returning errors or empty results.
- The bridge logs (stderr) show timeout errors waiting for elements.

### How to find updated selectors

1. Open [blinkit.com](https://blinkit.com) in your browser.
2. Open DevTools (F12 or Cmd+Shift+I).
3. Navigate to the relevant page (search results, cart, product detail, etc.).
4. Use the element inspector to find the new class names or DOM structure.
5. Look for stable attributes: `data-*` attributes, ARIA roles, or structural relationships (e.g., "the second `div` inside the product card") are more stable than class names, but Blinkit's markup has few of these.

### Tips for writing resilient selectors

- Prefer `data-*` attributes and ARIA roles over class names when available.
- Use structural selectors (`nth-child`, parent-child relationships) as a last resort.
- Test with both headless and headed mode. Run the server with `debug: true` in your config to see the browser in action.
- The bridge has a `debugHighlight()` helper that outlines matched elements in debug mode -- use it during development.

### Testing selector changes

1. Set `debug: true` and `headless: false` in your `~/.blinkit-mcp/config.json` to watch the browser.
2. Run the MCP server in dev mode: `bun run dev`.
3. Trigger the relevant tool from an MCP client and observe the browser behavior.
4. Verify the tool returns correct, well-structured data.

---

## Testing

### Running tests

```bash
bun test
```

Tests use `bun:test` (Bun's built-in test runner). Test files live in `test/` and follow the pattern `test/unit/<module>.test.ts`.

### What is tested

Current test coverage includes:

- `test/unit/session-manager.test.ts` -- SessionManager in-memory state behavior
- `test/unit/rate-limiter.test.ts` -- token bucket rate limiter
- `test/unit/spending-guard.test.ts` -- spending limit enforcement
- `test/unit/config.test.ts` -- configuration loading and validation
- `test/mocks/blinkit-api.ts` -- shared mock utilities

### Writing new tests

Tools and services interact with external systems (Blinkit's API, a browser). Tests must use mocks.

**Mocking BrowserManager:**

```typescript
import { describe, test, expect, mock } from "bun:test";

const mockBrowserManager = {
  sendCommand: mock(() =>
    Promise.resolve({
      id: "test-id",
      success: true,
      data: { products: [{ id: "1", name: "Milk", price: 50 }] },
    })
  ),
  ensureReady: mock(() => Promise.resolve()),
  isRunning: mock(() => true),
};
```

**Mocking the HTTP client:**

```typescript
const mockHttpClient = {
  get: mock(() =>
    Promise.resolve({ ok: true, data: { products: [] } })
  ),
  post: mock(() =>
    Promise.resolve({ ok: true, data: {} })
  ),
};
```

**Building a mock AppContext:**

```typescript
import { Logger } from "../../src/core/logger.ts";

const mockCtx = {
  httpClient: mockHttpClient,
  browserManager: mockBrowserManager,
  sessionManager: new SessionManager(new Logger("error")),
  rateLimiter: { acquire: mock(() => Promise.resolve()) },
  spendingGuard: { check: mock(() => ({ allowed: true })) },
  logger: new Logger("error"),
  config: { /* minimal config */ },
} as unknown as AppContext;
```

Test the service layer directly. Verify that it calls the HTTP client first, falls back to the browser manager on failure, and returns correctly shaped data.

---

## Code Style

### TypeScript strictness

- Do not use `any`. Use `unknown` when the type is genuinely unknown, then narrow with type guards or assertions.
- Define shared interfaces in `src/types.ts`.
- Use `as const` for constant objects and string literals where appropriate.

### Validation

- Use Zod for all external input validation (tool inputs, config files).
- Validate at the boundary (tools layer), not deep in services.

### Logging

**This is critical.** The MCP protocol uses JSON-RPC over stdio. Any output written to stdout that is not valid JSON-RPC will corrupt the protocol and crash the connection.

- Use the `Logger` class from `src/core/logger.ts` for all logging. It writes exclusively to stderr.
- **NEVER use `console.log`.** It writes to stdout and will break the MCP transport.
- `console.error` is safe (writes to stderr), but prefer the Logger class for consistent formatting.
- In the Playwright bridge, use the `log()` helper function (writes to stderr). Never use `console.log` there either -- it would corrupt the bridge's JSON protocol.

### Imports

- Use `.ts` extensions in import paths (Bun requires this).
- Use `type` imports for type-only imports: `import type { Foo } from "./bar.ts"`.

### General conventions

- Name tool files with kebab-case matching the tool name: `search_products` lives in `search-products.ts`.
- Name services with kebab-case and a `-service` suffix: `product-service.ts`.
- Export tool definitions as named exports (not default exports).
- Keep tool handlers thin -- delegate logic to services.

---

## Submitting Changes

1. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes, following the architecture and code style guidelines above.

3. Run the full test suite and confirm it passes:

   ```bash
   bun test
   ```

4. Commit with a clear, concise message describing what changed and why.

5. Open a pull request against `main`. In the PR description:

   - Describe what the change does and why it is needed.
   - List any new tools, services, or bridge commands added.
   - Note if selectors were updated and how you verified them.
   - Include test results (paste the output of `bun test`).

6. Respond to review feedback. Keep discussion focused on the code.
