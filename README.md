# blinkit-mcp

An MCP (Model Context Protocol) server that wraps [blinkit.com](https://blinkit.com/) -- India's quick-commerce grocery delivery platform -- enabling AI assistants to search products, manage cart, and place orders.

Blinkit has no public API. This server uses a hybrid approach: direct HTTP calls where possible, and Playwright browser automation as a fallback. Playwright runs in-process, managed by the BrowserManager class.

## Features

- **Authentication** -- OTP-based phone login with persistent session storage
- **Product search** -- Search by keyword, browse categories, view product details
- **Cart management** -- Add, update, remove items; view cart totals
- **Checkout and payment** -- Full checkout flow with address selection and UPI payment
- **Order tracking** -- View order history and track active deliveries in real time
- **Spending safeguards** -- Configurable warning threshold and hard spending limit
- **Location awareness** -- Automatic IP-based geolocation with manual override (Blinkit inventory is hyper-local)

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [pnpm](https://pnpm.io/) v8 or later
- A Blinkit account (Indian phone number for OTP login)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/roeintheglasses/blinkit-mcp.git
   cd blinkit-mcp
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Install Playwright with Firefox:

   ```bash
   npx playwright install firefox
   ```

4. Create the configuration directory:

   ```bash
   mkdir -p ~/.blinkit-mcp
   ```

5. (Optional) Create a config file with your defaults:

   ```json
   {
     "default_lat": 28.6139,
     "default_lon": 77.209,
     "warn_threshold": 500,
     "max_order_amount": 2000,
     "headless": true
   }
   ```

   Save this to `~/.blinkit-mcp/config.json`. See the [Configuration](#configuration) section for all available options.

## MCP Client Configuration

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blinkit": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/blinkit-mcp/src/index.ts"]
    }
  }
}
```

### Claude Code

Run the following command:

```bash
claude mcp add blinkit -- npx tsx /absolute/path/to/blinkit-mcp/src/index.ts
```

### Generic MCP Client

Use stdio transport with the following command:

```
npx tsx /absolute/path/to/blinkit-mcp/src/index.ts
```

Replace `/absolute/path/to/blinkit-mcp` with the actual path where you cloned the repository.

## Configuration

Configuration is loaded from `~/.blinkit-mcp/config.json`. Environment variables override file-based config.

### Config Options

| Option             | Type      | Default | Description                                                                                                     |
| ------------------ | --------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `default_lat`      | `number`  | --      | Default delivery latitude (-90 to 90). Falls back to IP geolocation if unset.                                   |
| `default_lon`      | `number`  | --      | Default delivery longitude (-180 to 180). Falls back to IP geolocation if unset.                                |
| `warn_threshold`   | `number`  | `500`   | Cart value (INR) at which a spending warning is returned.                                                       |
| `max_order_amount` | `number`  | `2000`  | Hard limit (INR). Checkout is blocked if the cart exceeds this amount.                                          |
| `headless`         | `boolean` | `true`  | Run the Playwright browser in headless mode. Set to `false` to see the browser window.                          |
| `debug`            | `boolean` | `false` | Enable debug logging. Also forces headed mode and applies `slow_mo`.                                            |
| `slow_mo`          | `number`  | `0`     | Milliseconds to slow down each Playwright action. Useful for debugging. Defaults to 500 when `debug` is `true`. |

### Environment Variables

| Variable                   | Overrides                                |
| -------------------------- | ---------------------------------------- |
| `BLINKIT_DEFAULT_LAT`      | `default_lat`                            |
| `BLINKIT_DEFAULT_LON`      | `default_lon`                            |
| `BLINKIT_WARN_THRESHOLD`   | `warn_threshold`                         |
| `BLINKIT_MAX_ORDER_AMOUNT` | `max_order_amount`                       |
| `BLINKIT_HEADLESS`         | `headless` (set to `"false"` to disable) |
| `BLINKIT_DEBUG`            | `debug` (set to `"true"` to enable)      |
| `BLINKIT_SLOW_MO`          | `slow_mo`                                |

## Available Tools

### Auth (4 tools)

| Tool                 | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `check_login_status` | Check if the current session is authenticated with Blinkit |
| `login`              | Initiate OTP login with a phone number. Sends an SMS OTP.  |
| `enter_otp`          | Submit the 4-digit OTP received via SMS to complete login  |
| `logout`             | Log out and clear saved session and auth tokens            |

### Location (3 tools)

| Tool                  | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `set_location`        | Set delivery location by searching for an address or area name |
| `get_saved_addresses` | List the user's saved delivery addresses (requires login)      |
| `select_address`      | Select a saved address by index for delivery during checkout   |

### Browse and Search (4 tools)

| Tool                  | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `search_products`     | Search for products by keyword. Returns names, prices, and IDs.                     |
| `get_product_details` | Get full details for a product by ID (price, description, brand, nutrition, images) |
| `browse_categories`   | List top-level product categories with IDs                                          |
| `browse_category`     | Get products within a specific category or subcategory                              |

### Cart (5 tools)

| Tool               | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `get_cart`         | View current cart contents, item quantities, and total (requires login)     |
| `add_to_cart`      | Add a product to cart by product ID with optional quantity (requires login) |
| `update_cart_item` | Change quantity of a cart item. Set to 0 to remove. (requires login)        |
| `remove_from_cart` | Remove a specific quantity of a product from cart (requires login)          |
| `clear_cart`       | Empty the entire cart (requires login)                                      |

### Orders and Payment (6 tools)

| Tool                | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `checkout`          | Proceed to checkout from cart. Returns next step hint (`select_address` or `payment`).     |
| `get_order_history` | View past orders with IDs, dates, totals, and status (requires login)                      |
| `track_order`       | Get real-time tracking status of an order. Defaults to most recent order. (requires login) |
| `get_upi_ids`       | Get available UPI IDs from the payment page after checkout                                 |
| `select_upi_id`     | Select or enter a UPI VPA for payment (e.g., `user@ybl`)                                   |
| `pay_now`           | Complete the transaction by confirming payment                                             |

**Total: 22 tools**

## Architecture

### Hybrid HTTP + Playwright

Blinkit does not expose a public API. This server takes a two-pronged approach:

1. **Direct HTTP** -- For endpoints that have been reverse-engineered (search, product details, categories, cart operations). These are fast and lightweight.
2. **Playwright browser automation** -- For authentication (OTP flow), checkout, payment, and any endpoint that cannot be called directly. Uses Firefox in headless mode by default.

Each tool can have either an HTTP or Playwright implementation. The architecture is designed so individual tools can be migrated from Playwright to direct HTTP as endpoints are discovered.

### In-Process Playwright

Browser automation runs in-process. The `BrowserManager` class (`src/core/browser-manager.ts`) directly manages the Playwright Browser, BrowserContext, and Page instances. Flow modules in `src/playwright/` contain the browser automation logic as plain async functions. Services call these functions directly -- no subprocess, no IPC, no serialization overhead.

### Layer Diagram

```
MCP Client (Claude, etc.)
        |
   stdio transport
        |
   MCP Server (Node.js)
        |
   +----+----+
   |         |
 Tools    Tools
   |         |
Services  Services
   |         |
   +----+----+
   |         |
HTTP Client  Browser Manager
   |              |
Blinkit API   Playwright Flow Modules
                  |
              Firefox Browser
```

**Layers:**

- **MCP Tools Layer** (`src/tools/`) -- MCP tool definitions with input schemas and handlers. Thin wrappers that delegate to services.
- **Service Layer** (`src/services/`) -- Business logic. HTTP-first, Playwright fallback. (AuthService, ProductService, CartService, OrderService, PaymentService, LocationService, SpendingGuard).
- **Core Layer** (`src/core/`) -- Infrastructure components (BrowserManager, BlinkitHttpClient, SessionManager, RateLimiter, Logger).
- **Playwright Flow Modules** (`src/playwright/`) -- Browser automation functions that operate on a Playwright Page and return typed results.

### Session Persistence

Auth tokens and browser storage state are saved to `~/.blinkit-mcp/` so that sessions survive server restarts. The server attempts to reuse existing sessions on startup and only triggers re-authentication when the session has expired.

## Usage Example

A typical conversation flow with an AI assistant:

```
User: Order some groceries from Blinkit

  1. [check_login_status] --> Not logged in
  2. [login] phone_number: "9876543210" --> OTP sent

User: The OTP is 1234

  3. [enter_otp] otp: "1234" --> Logged in successfully
  4. [set_location] location_name: "Delhi" --> Location set

User: Find me some milk

  5. [search_products] query: "milk" --> Returns list of milk products with IDs and prices

User: Add the Amul Taaza 500ml to my cart

  6. [add_to_cart] product_id: "12345", quantity: 2 --> Added to cart

User: What's in my cart?

  7. [get_cart] --> Shows cart with items, quantities, and total

User: Looks good, let's checkout

  8. [checkout] --> Returns next_step: "select_address"
  9. [get_saved_addresses] --> Lists saved addresses
 10. [select_address] address_index: 0 --> Address selected
 11. [get_upi_ids] --> Lists available UPI IDs
 12. [select_upi_id] upi_id: "user@ybl" --> UPI selected

User: Yes, go ahead and pay

 13. [pay_now] --> Payment initiated, approve on your UPI app

User: Is my order on the way?

 14. [track_order] --> Order confirmed, estimated delivery in 10 minutes
```

## Troubleshooting

### "Store unavailable" or empty search results

Blinkit inventory is hyper-local. Each dark store serves a small geographic area. If you get empty results or a "store unavailable" error:

- Verify your location is set to a Blinkit-serviceable area using `set_location`.
- Try a different address. Not all areas have Blinkit coverage.
- Some products are stocked only at certain dark stores.

### OTP not received or login timeout

- Ensure the phone number is a valid 10-digit Indian mobile number (starting with 6-9).
- Wait at least 30 seconds before retrying. Blinkit may rate-limit OTP requests.
- Playwright operations have a 60-second timeout. If login takes longer, the operation will time out and the command will need to be retried.

### Playwright browser fails to launch

- Confirm Node.js v18+ is installed and available on your `PATH`.
- Confirm Firefox is installed for Playwright: run `npx playwright install firefox`.
- Check that `tsx` is available (it is installed as a dev dependency).
- Set `debug` to `true` in your config to see the browser window and get verbose logs.

### Rate limiting

The server includes built-in rate limiting (token bucket with 5 tokens, refilling at 2/sec, minimum 200ms between requests). If you encounter rate limiting from Blinkit:

- Slow down requests. Avoid rapid-fire tool calls.
- Wait a few minutes before retrying if you receive repeated errors.
- Rate limit parameters are not currently user-configurable.

### Spending limit exceeded

If checkout is blocked, the cart total has exceeded your `max_order_amount` (default: 2000 INR). Either remove items to bring the total down or increase the limit in your config.

### Session expired

If tools return authentication errors after a period of inactivity, your Blinkit session may have expired. Run `check_login_status` and then `login` again if needed. The server persists sessions to disk, but Blinkit may invalidate them server-side.

## License

MIT
