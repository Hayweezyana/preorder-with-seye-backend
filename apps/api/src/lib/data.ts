export const products = [
  {
    id: "prd_1",
    tenantId: "tenant_demo",
    slug: "seye-red-dress",
    name: "Seye Red Dress",
    category: "fashion",
    priceNgn: 15000,
    imageUrl: "https://res.cloudinary.com/demo/image/upload/red-dress.jpg",
    inStock: true,
    description: "Elegant red dress for premium occasions.",
    variants: [
      { id: "var_1", size: "M", color: "Red", stock: 8 },
      { id: "var_2", size: "L", color: "Red", stock: 2 }
    ]
  }
];

export const carts = new Map<string, unknown>();

export const orders = [
  {
    id: "ord_1",
    tenantId: "tenant_demo",
    orderRef: "SWS-1001",
    status: "processing",
    totalNgn: 15000,
    createdAt: new Date().toISOString()
  }
];
