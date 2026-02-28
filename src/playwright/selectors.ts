// Centralized CSS/text selectors for all Playwright flows.
// Update these when Blinkit changes their UI.

export const SELECTORS = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  LOGIN_BUTTON: "text='Login'",
  PROFILE_BUTTON_CONTAINER: "div[class*='ProfileButton__Container']",
  PROFILE_BUTTON:
    "div[class*='ProfileButton'], div[class*='AccountButton'], div[class*='UserProfile']",
  PHONE_INPUT: "input[type='tel'], input[name='mobile'], input[type='text']",
  NEXT_BUTTON: "text='Next'",
  CONTINUE_BUTTON: "text='Continue'",
  OTP_INPUT_GENERIC: "input",
  OTP_INPUT_NUMERIC: "input[inputmode='numeric']",
  OTP_INPUT_NAMED:
    "input[data-test-id='otp-input'], input[name*='otp'], input[id*='otp']",
  MY_ACCOUNT: "text='My Account'",
  ACCOUNT: "text='Account'",
  USER_PROFILE: ".user-profile",

  // ── Search ────────────────────────────────────────────────────────────────
  SEARCH_LINK: "a[href='/s/']",
  SEARCH_PLACEHOLDER: "div[class*='SearchBar__PlaceholderContainer']",
  SEARCH_INPUT_PLACEHOLDER: "input[placeholder*='Search']",
  SEARCH_INPUT: "input[placeholder*='Search'], input[type='text']",
  SEARCH_TEXT: "text='Search'",
  PRODUCT_CARD_ADD: "div[role='button']:has-text('ADD')",
  NO_RESULTS_FOUND: "text='No results found'",
  NO_RESULTS_REGEX: "text=/no results/i",

  // Product details page
  PRODUCT_DETAIL_NAME: "h1, [class*='ProductName']",
  PRODUCT_DETAIL_PRICE: "[class*='Price'], [class*='price']",
  PRODUCT_DETAIL_DESCRIPTION: "[class*='Description'], [class*='description']",
  PRODUCT_DETAIL_BRAND: "[class*='Brand'], [class*='brand']",
  PRODUCT_IMAGE: "img[class*='product'], img[class*='Product']",

  // Category
  CATEGORY_LINK: "a[href*='/cn/']",
  CATEGORY_PRODUCT_NAME: "div[class*='line-clamp']",

  // ── Cart ──────────────────────────────────────────────────────────────────
  CART_BUTTON:
    "div[class*='CartButton__Button'], div[class*='CartButton__Container']",
  CART_BUTTON_FULL:
    "div[class*='CartButton__Button'], div[class*='CartButton__Container'], div[class*='CartButton']",
  CART_PRODUCT: "div[class*='CartProduct']",
  CART_PRODUCT_TITLE: "div[class*='ProductTitle']",
  CART_PRODUCT_VARIANT: "div[class*='ProductVariant']",
  CART_PRODUCT_PRICE: "div[class*='Price-']",
  CART_BILL: "div[class*='Bill']",
  BILL_DETAILS_REGEX: "text=/Bill details/i",
  PROCEED_HAS_TEXT: "button:has-text('Proceed')",
  ORDERING_FOR: "text='ordering for'",
  ICON_PLUS: ".icon-plus",
  ICON_MINUS: ".icon-minus",
  ICON_PLUS_MINUS: ".icon-plus, .icon-minus",
  STORE_UNAVAILABLE_MODAL: "text=\"Sorry, can't take your order\"",

  // ── Location ──────────────────────────────────────────────────────────────
  LOCATION_INPUT_NAME: "input[name='select-locality']",
  LOCATION_INPUT:
    "input[name='select-locality'], input[placeholder*='search delivery location']",
  LOCATION_BAR: "div[class*='LocationBar__Container']",
  LOCATION_SEARCH_RESULT:
    "div[class*='LocationSearchBox__LocationItemContainer']",
  CURRENTLY_UNAVAILABLE: "text='Currently unavailable'",

  // ── Address ───────────────────────────────────────────────────────────────
  SELECT_DELIVERY_ADDRESS: "text='Select delivery address'",
  ADDRESS_ITEM: "div[class*='AddressList__AddressItemWrapper']",
  ADDRESS_LABEL: "div[class*='AddressList__AddressLabel']",
  ADDRESS_DETAILS: "div[class*='AddressList__AddressDetails']",

  // ── Checkout ──────────────────────────────────────────────────────────────
  PAYMENT_WIDGET: "#payment_widget",
  PROCEED_TO_PAY:
    "button:has-text('Proceed to Pay'), div:has-text('Proceed to Pay'), " +
    "button:has-text('Proceed to Payment'), button:has-text('Continue to Payment')",
  PAY_NOW_BUTTON:
    "button:has-text('Pay Now'), div:has-text('Pay Now')",
  ZPAYMENTS_PAY_NOW:
    "div[class*='Zpayments__Button']:has-text('Pay Now')",
  CLOSE_MODAL:
    "button[aria-label='close'], button[aria-label='Close'], div[class*='close']",

  // Delivery tip
  TIP_SECTION:
    "text=/[Dd]elivery [Tt]ip/, text=/[Aa]dd [Tt]ip/, text=/[Tt]ip your delivery/",
  NO_TIP: "text=/[Nn]o [Tt]ip/, text=/[Ss]kip/",

  // ── Payment (inside iframe) ───────────────────────────────────────────────
  QR_WRAPPER:
    "div[class*='QrWrapper'], div[class*='qr-wrapper'], div[class*='QrImage']",
  QR_DATA_IMAGE: "img[src^='data:image']",
  CANVAS: "canvas",
  GENERATE_QR: "text='Generate QR'",
  PAY_NOW_FRAME: "text='Pay Now'",

  // Payment method selectors (inside iframe)
  PAYMENT_WALLETS: "text='Wallets'",
  PAYMENT_CARD: "text=/credit or debit/i",
  PAYMENT_NETBANKING: "text='Netbanking'",
  PAYMENT_UPI: "text='UPI'",
  PAYMENT_CASH: "text='Cash'",
  PAYMENT_PAY_LATER: "text='Pay Later'",

  // ── Store Status ──────────────────────────────────────────────────────────
  STORE_CLOSED: "text='Store is closed'",
  HIGH_DEMAND: "text='High Demand'",

  // ── Orders ────────────────────────────────────────────────────────────────
  ORDER_CARD: "div[class*='OrderCard'], div[class*='order-card']",
  ORDER_STATUS: "div[class*='OrderStatus'], span[class*='order-status']",
  ORDER_TOTAL: "div[class*='OrderTotal'], span[class*='order-total']",
  ORDER_DATE: "div[class*='OrderDate'], span[class*='order-date']",
  ORDER_ITEMS: "div[class*='OrderItems'], div[class*='order-items']",
  ORDER_TRACKING_TIMELINE:
    "div[class*='Timeline'], div[class*='tracking-timeline']",
  ORDER_ETA: "div[class*='ETA'], span[class*='eta']",

  // ── Browser Manager ───────────────────────────────────────────────────────
  DETECT_MY_LOCATION: "Detect my location", // used with .filter({ hasText: ... })
} as const;

/** Dynamic selector: find a product card by its DOM id attribute */
export const productById = (id: string) => `div[id='${id}']`;
