# Contributing to blinkit-mcp

This guide covers everything you need to contribute to the blinkit-mcp project: a Model Context Protocol (MCP) server that enables AI assistants to interact with Blinkit for grocery delivery.

## Table of Contents

- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [Adding a New Tool](#adding-a-new-tool)
- [Flow Modules](#flow-modules)
- [Updating Selectors](#updating-selectors)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [pnpm](https://pnpm.io/) v8 or later
- Git

### Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/blinkit-mcp.git
   cd blinkit-mcp
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Install Playwright's Firefox browser (the only browser this project uses):

   ```bash
   npx playwright install firefox
   ```

4. Run the test suite to verify everything works:

   ```bash
   pnpm test
   ```

---

## Architecture Overview

The codebase is organized into four layers. Understanding this structure is essential before making changes.

```
MCP Client (Claude, etc.)
    |
    v
+--------------------------+
| MCP Tools Layer          |  src/tools/<category>/*.ts
| Zod validation, MCP      |
| response formatting       |
+--------------------------+
    |
    v
+--------------------------+
| Service Layer            |  src/services/*.ts
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
    v                v
  Blinkit API   +---------------------+
                | Playwright Flow     |
                | Modules (in-process)|
                +---------------------+
                  src/playwright/*.ts
                       |
                       v
                  Firefox Browser
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
- `browser-manager.ts` -- manages the Playwright Browser, BrowserContext, and Page lifecycle in-process
- `session-manager.ts` -- tracks authentication state, phone number, and location coordinates
- `rate-limiter.ts` -- token-bucket rate limiter to prevent API abuse
- `logger.ts` -- structured logging to stderr (never stdout)

### Layer 4: Playwright Flow Modules (`src/playwright/`)

Playwright runs in-process via flow modules. Each module exports plain async functions that accept a Playwright `Page` (and any required parameters) and return typed results. Services obtain a page by calling `browserManager.ensurePage()` and pass it directly to flow functions.

Flow modules:

| Module | Purpose |
|---|---|
| `helpers.ts` | Shared Playwright utilities (waiting, element queries, debug highlighting) |
| `auth-flow.ts` | Login and OTP entry flows |
| `search-flow.ts` | Product search and category browsing |
| `cart-flow.ts` | Cart manipulation (add, update, remove, clear) |
| `location-flow.ts` | Location setting and address selection |
| `checkout-flow.ts` | Checkout, UPI selection, and payment confirmation |

### Shared Types (`src/types.ts`)

All shared interfaces live in `src/types.ts`: `Product`, `Cart`, `CartItem`, `Address`, `OrderSummary`, `AppContext`, and others. Import from here rather than defining duplicate types.

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

  // Playwright fallback -- call flow function directly
  const page = await this.ctx.browserManager.ensurePage();
  const products = await getDeals(page, limit);
  return { products };
}
```

Follow the established pattern: attempt HTTP first, fall back to Playwright if needed. The Playwright fallback obtains a page via `browserManager.ensurePage()` and calls a flow function directly. Some operations (login, OTP entry, checkout) are Playwright-only because they require full browser interaction.

### Step 3: Add a flow function (if browser automation is needed)

If your tool requires Playwright, add a flow function to the appropriate module in `src/playwright/`. If no existing module fits, create a new one.

```typescript
// In src/playwright/search-flow.ts (or a new module)
import type { Page } from "playwright";
import type { Product } from "../types.ts";

export async function getDeals(page: Page, limit: number): Promise<Product[]> {
  await page.goto("https://blinkit.com/cn/deals-of-the-day/...");
  // ... scrape products using page selectors ...
  return products.slice(0, limit);
}
```

Flow functions are plain async functions. They accept a Playwright `Page` as the first argument, perform browser automation, and return typed results. No IPC protocol, no JSON serialization -- just function calls.

See [Flow Modules](#flow-modules) for conventions.

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
      -> httpClient.get/post(...)              [direct API call]
      -> browserManager.ensurePage()           [get Playwright page]
        -> flowFunction(page, ...)             [in-process browser automation]
```

---

## Flow Modules

Playwright browser automation is organized into flow modules in `src/playwright/`. Each module groups related automation logic and exports plain async functions.

### Module layout

| Module | Responsibility |
|---|---|
| `helpers.ts` | Shared Playwright utilities: element waiting, text extraction, debug highlighting |
| `auth-flow.ts` | Login page navigation, phone number entry, OTP submission |
| `search-flow.ts` | Product search, product detail scraping, category browsing |
| `cart-flow.ts` | Adding, updating, removing, and clearing cart items |
| `location-flow.ts` | Setting delivery location, listing and selecting saved addresses |
| `checkout-flow.ts` | Checkout initiation, UPI ID retrieval and selection, payment confirmation |

### Writing a flow function

Flow functions follow a consistent pattern:

```typescript
import type { Page } from "playwright";
import type { Product } from "../types.ts";

export async function searchProducts(
  page: Page,
  query: string,
  limit: number
): Promise<Product[]> {
  await page.goto(`https://blinkit.com/s/?q=${encodeURIComponent(query)}`);
  // Wait for results, extract data using selectors
  const products = await page.$$eval(".product-card", (cards) =>
    cards.map((card) => ({ /* ... */ }))
  );
  return products.slice(0, limit);
}
```

Key conventions:

1. The first parameter is always a Playwright `Page` instance, obtained by the caller via `browserManager.ensurePage()`.
2. Return typed results (not raw HTML or unstructured data). Define return types in `src/types.ts`.
3. Keep functions focused on a single automation task. Compose complex workflows from smaller functions.
4. Use helpers from `helpers.ts` for common operations (waiting for elements, extracting text, etc.).
5. Handle Playwright-specific errors (timeouts, missing elements) within the function and throw descriptive errors for the service layer to catch.

### How services call flow functions

Services obtain a Playwright page and pass it to flow functions directly:

```typescript
// In a service method
const page = await this.ctx.browserManager.ensurePage();
const products = await searchProducts(page, query, limit);
```

There is no IPC, no JSON serialization, and no command protocol. Flow functions are ordinary async function calls within the same Node.js process.

---

## Updating Selectors

This is the most common maintenance task. Blinkit frequently updates their website UI, which breaks CSS selectors used in the Playwright flow modules.

### Where selectors live

CSS selectors live in the flow modules under `src/playwright/*.ts`. Each flow module contains the selectors relevant to its domain (e.g., search selectors in `search-flow.ts`, cart selectors in `cart-flow.ts`). Search for `page.locator(`, `page.waitForSelector(`, and `querySelector` to find them.

### How to identify broken selectors

Symptoms:

- A tool that previously worked starts returning errors or empty results.
- Server logs (stderr) show Playwright timeout errors waiting for elements.

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
- The `helpers.ts` module includes a `debugHighlight()` utility that outlines matched elements in debug mode -- use it during development.

### Testing selector changes

1. Set `debug: true` and `headless: false` in your `~/.blinkit-mcp/config.json` to watch the browser.
2. Run the MCP server in dev mode: `pnpm run dev`.
3. Trigger the relevant tool from an MCP client and observe the browser behavior.
4. Verify the tool returns correct, well-structured data.

---

## Testing

### Running tests

```bash
pnpm test
```

Tests use vitest. Test files live in `test/` and follow the pattern `test/unit/<module>.test.ts`.

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
import { describe, test, expect, vi } from "vitest";

const mockPage = {
  goto: vi.fn(() => Promise.resolve()),
  locator: vi.fn(() => ({ click: vi.fn(), fill: vi.fn(), textContent: vi.fn() })),
  waitForSelector: vi.fn(() => Promise.resolve()),
  $$eval: vi.fn(() => Promise.resolve([])),
};

const mockBrowserManager = {
  ensurePage: vi.fn(() => Promise.resolve(mockPage)),
  isRunning: vi.fn(() => true),
};
```

**Mocking the HTTP client:**

```typescript
const mockHttpClient = {
  get: vi.fn(() =>
    Promise.resolve({ ok: true, data: { products: [] } })
  ),
  post: vi.fn(() =>
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
  rateLimiter: { acquire: vi.fn(() => Promise.resolve()) },
  spendingGuard: { check: vi.fn(() => ({ allowed: true })) },
  logger: new Logger("error"),
  config: { /* minimal config */ },
} as unknown as AppContext;
```

Test the service layer directly. Verify that it calls the HTTP client first, falls back to Playwright flow functions on failure, and returns correctly shaped data.

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

### Imports

- Use `.ts` extensions in import paths.
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
   pnpm test
   ```

4. Commit with a clear, concise message describing what changed and why.

5. Open a pull request against `main`. In the PR description:

   - Describe what the change does and why it is needed.
   - List any new tools, services, or flow modules added.
   - Note if selectors were updated and how you verified them.
   - Include test results (paste the output of `pnpm test`).

6. Respond to review feedback. Keep discussion focused on the code.
