export const MOCK_SEARCH_RESPONSE = {
  snippets: [
    {
      data: {
        products: [
          {
            product_id: 12345,
            name: "Amul Taaza Toned Fresh Milk",
            price: 27,
            mrp: 27,
            unit: "500 ml",
            is_in_stock: true,
            image_url: "https://cdn.blinkit.com/mock/milk.jpg",
          },
          {
            product_id: 12346,
            name: "Mother Dairy Full Cream Milk",
            price: 33,
            mrp: 33,
            unit: "500 ml",
            is_in_stock: true,
            image_url: "https://cdn.blinkit.com/mock/milk2.jpg",
          },
        ],
      },
    },
  ],
};

export const MOCK_PRODUCT_DETAILS = {
  product: {
    name: "Amul Taaza Toned Fresh Milk",
    price: 27,
    mrp: 27,
    unit: "500 ml",
    brand: "Amul",
    description: "Toned fresh milk with 3% fat content",
    is_in_stock: true,
    image_url: "https://cdn.blinkit.com/mock/milk.jpg",
    images: ["https://cdn.blinkit.com/mock/milk.jpg", "https://cdn.blinkit.com/mock/milk-back.jpg"],
    nutrition: {
      "Energy": "60 kcal",
      "Protein": "3g",
      "Fat": "3g",
    },
  },
};

export const MOCK_CART = {
  items: [
    {
      product_id: "12345",
      name: "Amul Taaza Toned Fresh Milk",
      quantity: 2,
      unit_price: 27,
      total_price: 54,
      unit: "500 ml",
    },
  ],
  subtotal: 54,
  delivery_fee: 0,
  total: 54,
};

export const MOCK_CATEGORIES = {
  categories: [
    { id: "dairy-bread-eggs", name: "Dairy, Bread & Eggs", icon_url: "https://cdn.blinkit.com/mock/dairy.png" },
    { id: "fruits-vegetables", name: "Fruits & Vegetables", icon_url: "https://cdn.blinkit.com/mock/fruits.png" },
    { id: "snacks-munchies", name: "Snacks & Munchies", icon_url: "https://cdn.blinkit.com/mock/snacks.png" },
  ],
};

export const MOCK_ORDERS = {
  orders: [
    {
      order_id: "BL-2024-001",
      date: "2024-12-25",
      total: 450,
      item_count: 5,
      status: "Delivered",
      items_summary: "Milk, Bread, Eggs, Butter, Cheese",
    },
  ],
};
