# Blinkit MCP Server — Requirements

## Overview

An MCP (Model Context Protocol) server that wraps [blinkit.com](https://blinkit.com/) — India's quick-commerce grocery delivery platform. Enables AI assistants to search products, manage cart, and place grocery orders on behalf of the user.

## Tech Stack

- **Language:** TypeScript
- **Package manager:** bun
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Browser automation:** Playwright (for OTP auth + API fallback)
- **HTTP client:** For direct API calls (e.g. undici/fetch)
- **Target clients:** Claude (Code/Desktop), OpenClaw, any MCP-compatible client

## Architecture

### Hybrid Approach

1. **Primary:** Direct HTTP API calls — fast, lightweight, no browser needed
2. **Auth:** Playwright browser automation for OTP-based login (phone + SMS OTP)
3. **Fallback:** Playwright browser automation for any endpoint that can't be reverse-engineered

Each tool can have two implementations (HTTP API vs Playwright). The architecture should make this **swappable per-tool** so we can start with Playwright and migrate individual tools to direct API as we reverse-engineer endpoints.

### Known API Surface

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `blinkit.com/v1/layout/product/{prid}` | POST | Product details |
| `blinkit.in/v5/search/*` | GET/POST | Product search |

Required headers for API calls:
- `auth_key` — static key from web client
- `lat`, `lon` — delivery location (inventory is hyper-local)
- `device_id`, `session_uuid` — UUIDs
- `access_token` — null for unauthenticated, token for logged-in
- `app_client: consumer_web`

### Reference Implementation

If direct API reverse-engineering isn't feasible for certain tools, follow the Playwright-based approach from [hereisSwapnil/blinkit-mcp](https://github.com/hereisSwapnil/blinkit-mcp).

## MCP Tools

### Auth & Session (4 tools)

| Tool | Description |
|------|-------------|
| `check_login_status` | Check if the current session is authenticated |
| `login` | Initiate OTP login with phone number (launches Playwright) |
| `enter_otp` | Submit the OTP received via SMS |
| `logout` | Clear the session and auth tokens |

### Location & Address (3 tools)

| Tool | Description |
|------|-------------|
| `set_location` | Set delivery location (lat/lon or address search) |
| `get_saved_addresses` | List user's saved delivery addresses |
| `select_address` | Select a saved address for delivery |

### Browse & Search (4 tools)

| Tool | Description |
|------|-------------|
| `search_products` | Search for products by query string |
| `get_product_details` | Get full details for a product by ID |
| `browse_categories` | List top-level product categories |
| `browse_category` | Get products within a specific category |

### Cart (5 tools)

| Tool | Description |
|------|-------------|
| `get_cart` | View current cart contents and total |
| `add_to_cart` | Add a product (by ID) to cart |
| `update_cart_item` | Change quantity of a cart item |
| `remove_from_cart` | Remove a product from cart |
| `clear_cart` | Empty the entire cart |

### Orders (3 tools)

| Tool | Description |
|------|-------------|
| `checkout` | Initiate checkout — shows order summary, asks for confirmation |
| `get_order_history` | View past orders |
| `track_order` | Get real-time status of an active order |

**Total: 19 tools**

## Authentication

- **Method:** Phone number + SMS OTP (no username/password)
- **Flow:** `login` (phone) → SMS arrives → `enter_otp` (OTP typed in chat) → session established
- **Persistence:** Auth tokens/cookies saved to `~/.blinkit-mcp/auth.json`
- **Session reuse:** On server start, load saved auth and verify validity. Re-login only when expired.
- **Single user only** — no multi-account support needed

## Location Handling

- **Default location:** Configurable via config file or environment variable (`BLINKIT_DEFAULT_LAT`, `BLINKIT_DEFAULT_LON`)
- **Override:** User can change location per session via `set_location`
- **Importance:** Blinkit inventory varies by dark store — location MUST be set before browsing/searching

## Spending Safeguards

- **Warning threshold:** Configurable amount (e.g. ₹500). When cart exceeds this, the tool returns a warning message.
- **Hard limit:** Configurable max order amount (e.g. ₹2000). Checkout is blocked if cart exceeds this.
- **Payment confirmation:** `checkout` tool always asks for explicit user confirmation before executing payment ("Are you sure you want to pay ₹X?")
- **Defaults:** Configurable via config file or environment variables (`BLINKIT_WARN_THRESHOLD`, `BLINKIT_MAX_ORDER_AMOUNT`)

## Rate Limiting

- Built-in sensible delays between API calls to avoid getting blocked
- Not configurable in v1 — just reasonable defaults (e.g. 200-500ms between requests)

## Configuration

Config stored in `~/.blinkit-mcp/config.json` or via environment variables:

```
BLINKIT_DEFAULT_LAT        # Default delivery latitude
BLINKIT_DEFAULT_LON        # Default delivery longitude
BLINKIT_WARN_THRESHOLD     # Cart value warning threshold (INR)
BLINKIT_MAX_ORDER_AMOUNT   # Hard limit on order amount (INR)
```

## Distribution

- **Open source** — MIT license
- **GitHub** — public repository
- **npm** — publish as installable package
- **README** with setup instructions, MCP client config examples (Claude Desktop, Claude Code, OpenClaw)

## Phased Build Plan

### Phase 1 — Foundation
- Project scaffolding (TypeScript, bun, MCP SDK)
- Playwright setup + auth flow (login, enter_otp, check_login_status, logout)
- Session persistence (~/.blinkit-mcp/auth.json)
- Config system (location defaults, spending limits)

### Phase 2 — Browse & Search
- set_location, get_saved_addresses, select_address
- search_products, get_product_details
- browse_categories, browse_category
- Attempt direct API for search/product detail, fall back to Playwright

### Phase 3 — Cart
- get_cart, add_to_cart, update_cart_item, remove_from_cart, clear_cart
- Spending threshold warnings

### Phase 4 — Orders
- checkout (with confirmation prompt + hard limit check)
- get_order_history
- track_order

### Phase 5 — Polish & Publish
- Error handling, edge cases
- npm packaging
- Documentation
- GitHub release
