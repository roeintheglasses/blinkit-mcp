// Centralized CSS/text selectors for all Playwright flows.
// Update these when Blinkit changes their UI.

export const SELECTORS = {
  // Login
  LOGIN_BUTTON: "text='Login'",
  PHONE_INPUT: "input[type='tel']",
  CONTINUE_BUTTON: "text='Continue'",
  OTP_INPUTS: "input[type='tel']",
  OTP_FIRST_INPUT: "input[inputmode='numeric']",

  // Search
  SEARCH_LINK: "a[href='/s/']",
  SEARCH_PLACEHOLDER: "div[class*='SearchBar__PlaceholderContainer']",
  SEARCH_INPUT:
    "input[type='text'][name='q'], input[type='search'], input[placeholder*='Search']",
  PRODUCT_CARD:
    "div[class*='Product__UpdatedPlpProductContainer'], div[role='listitem']",
  PRODUCT_NAME:
    "div[class*='Product__UpdatedTitle'], div[class*='plp-product__name']",
  PRODUCT_PRICE:
    "div[class*='Product__UpdatedPriceAndAtcContainer'] div[class*='price'], div[class*='plp-product__price']",
  PRODUCT_MRP:
    "div[class*='Product__UpdatedPriceAndAtcContainer'] span[style*='line-through']",
  PRODUCT_WEIGHT:
    "div[class*='plp-product__quantity--box'], div[class*='Product__UpdatedWeight']",
  PRODUCT_IMAGE: "img[class*='product'], img[class*='Product']",
  PRODUCT_ADD_BTN: "button[class*='AddToCart'], button:has-text('ADD')",

  // Cart
  CART_BUTTON: "div[class*='CartButton__Button'], a[href='/checkout/cart']",
  CART_ITEM: "div[class*='CartItem'], div[class*='cart-item']",
  CART_ITEM_NAME:
    "div[class*='CartItem__ItemName'], div[class*='cart-item__name']",
  CART_ITEM_PRICE:
    "div[class*='CartItem__ItemPrice'], div[class*='cart-item__price']",
  CART_ITEM_QTY:
    "div[class*='CartItem__Quantity'], span[class*='cart-item__qty']",
  CART_TOTAL: "div[class*='CartTotal'], div[class*='bill-details__total']",
  CART_PLUS: ".icon-plus, button[aria-label='increase']",
  CART_MINUS: ".icon-minus, button[aria-label='decrease']",
  CART_REMOVE: "button[aria-label='remove'], text='Remove'",
  CART_EMPTY: "text='Your cart is empty', text='Add items to your cart'",

  // Location
  LOCATION_BAR:
    "div[class*='LocationBar__Container'], div[class*='location-bar']",
  LOCATION_INPUT:
    "input[name='select-locality'], input[placeholder*='location'], input[placeholder*='area']",
  LOCATION_SUGGESTION:
    "div[class*='LocationSearch__ResultItem'], div[class*='location-suggestion']",

  // Addresses
  ADDRESS_LIST:
    "div[class*='AddressListItem__AddressItemWrapper'], div[class*='address-item']",
  ADDRESS_LABEL:
    "div[class*='AddressListItem__Label'], span[class*='address-label']",
  ADDRESS_LINE:
    "div[class*='AddressListItem__Address'], span[class*='address-line']",

  // Checkout
  PROCEED_BUTTON:
    "button:has-text('Proceed'), button:has-text('Next'), button:has-text('Continue')",
  ORDER_SUMMARY: "div[class*='OrderSummary'], div[class*='bill-details']",
  PAY_BUTTON: "button:has-text('Pay'), button:has-text('Place Order')",
  PAYMENT_WIDGET: "#payment_widget",

  // Orders
  ORDER_CARD: "div[class*='OrderCard'], div[class*='order-card']",
  ORDER_STATUS: "div[class*='OrderStatus'], span[class*='order-status']",
  ORDER_TOTAL: "div[class*='OrderTotal'], span[class*='order-total']",
  ORDER_DATE: "div[class*='OrderDate'], span[class*='order-date']",
  ORDER_ITEMS: "div[class*='OrderItems'], div[class*='order-items']",
  ORDER_TRACKING_TIMELINE:
    "div[class*='Timeline'], div[class*='tracking-timeline']",
  ORDER_ETA: "div[class*='ETA'], span[class*='eta']",
} as const;
