const { ObjectId } = require("mongodb");

const categorySeeds = [
  { name: "Fashion", slug: "fashion" },
  { name: "Electronics", slug: "electronics" },
  { name: "Beauty", slug: "beauty" },
  { name: "Home & Living", slug: "home-living" },
  { name: "Sports", slug: "sports" },
  { name: "Kids", slug: "kids" }
];

const productSeeds = [
  ["seye-cotton-shirt", "Classic Cotton Shirt", "fashion", 16500, "M", "White", 14, [1015, 1016]],
  ["seye-linen-trouser", "Linen Straight Trouser", "fashion", 21500, "L", "Khaki", 10, [1020, 1024]],
  ["seye-city-sneaker", "City Walk Sneakers", "fashion", 32500, "42", "Black", 8, [1031, 1038]],
  ["seye-ankara-gown", "Ankara Evening Gown", "fashion", 41500, "M", "Blue", 6, [1044, 1050]],
  ["pulse-wireless-headset", "Pulse Wireless Headset", "electronics", 54000, "Standard", "Rose Gold", 12, [1065, 1069]],
  ["spark-smart-watch", "Spark Smart Watch", "electronics", 68500, "Standard", "Silver", 9, [1074, 1079]],
  ["nova-portable-speaker", "Nova Portable Speaker", "electronics", 29200, "Standard", "Green", 11, [1082, 1084]],
  ["jet-mini-projector", "Jet Mini Projector", "electronics", 84000, "Standard", "Matte Black", 5, [1080, 1094]],
  ["silk-glow-serum", "Silk Glow Face Serum", "beauty", 12800, "50ml", "Amber", 18, [110, 111]],
  ["clear-skin-kit", "Clear Skin 3-Step Kit", "beauty", 18900, "Kit", "Neutral", 15, [112, 114]],
  ["cocoa-body-butter", "Cocoa Body Butter", "beauty", 9200, "250ml", "Brown", 22, [115, 116]],
  ["velvet-matte-lipset", "Velvet Matte Lip Set", "beauty", 14600, "Set", "Red", 16, [117, 118]],
  ["soma-dining-chair", "Soma Dining Chair", "home-living", 35600, "Standard", "Teak", 7, [119, 120]],
  ["lush-bedspread", "Lush Cotton Bedspread", "home-living", 27600, "Queen", "Olive", 13, [121, 122]],
  ["aero-blender-pro", "Aero Blender Pro", "home-living", 47400, "Standard", "Cream", 8, [123, 124]],
  ["zen-desk-lamp", "Zen Adjustable Desk Lamp", "home-living", 19800, "Standard", "Forest Green", 17, [125, 126]],
  ["motion-training-shoe", "Motion Training Shoe", "sports", 39800, "43", "Orange", 9, [127, 128]],
  ["prime-yoga-mat", "Prime Yoga Mat", "sports", 13800, "Standard", "Navy", 21, [129, 130]],
  ["mini-explorer-backpack", "Mini Explorer Backpack", "kids", 16400, "Small", "Yellow", 19, [131, 132]],
  ["kids-rain-jacket", "Kids Rain Jacket", "kids", 19200, "8-10Y", "Green", 14, [133, 134]]
];

module.exports = {
  async up(db) {
    const now = new Date();
    const tenant = await db.collection("tenants").findOne({ slug: "tenant_demo" });
    if (!tenant?._id) {
      return;
    }

    const categoryIdBySlug = new Map();
    for (const category of categorySeeds) {
      await db.collection("categories").updateOne(
        { tenantId: tenant._id, slug: category.slug },
        {
          $setOnInsert: {
            tenantId: tenant._id,
            slug: category.slug,
            createdAt: now
          },
          $set: { name: category.name, updatedAt: now }
        },
        { upsert: true }
      );
      const savedCategory = await db.collection("categories").findOne({ tenantId: tenant._id, slug: category.slug });
      if (savedCategory?._id) {
        categoryIdBySlug.set(category.slug, savedCategory._id);
      }
    }

    for (const [slug, name, categorySlug, priceNgn, size, color, stock, imageIds] of productSeeds) {
      const imageUrls = imageIds.map((id) => `https://picsum.photos/id/${id}/900/700`);
      const primaryUrl = imageUrls[0];
      const categoryId = categoryIdBySlug.get(categorySlug);
      if (!categoryId) {
        continue;
      }

      await db.collection("products").updateOne(
        { tenantId: tenant._id, slug },
        {
          $setOnInsert: {
            tenantId: tenant._id,
            categoryId,
            slug,
            name,
            description: `${name} curated for fast everyday commerce.`,
            imageUrl: primaryUrl,
            imageFit: "cover",
            images: imageUrls.map((url) => ({ url, publicId: null, fit: "cover" })),
            active: true,
            variants: [
              { _id: new ObjectId(), sku: `${slug.toUpperCase().replace(/-/g, "_")}_A`, size, color, stock, priceNgn },
              { _id: new ObjectId(), sku: `${slug.toUpperCase().replace(/-/g, "_")}_B`, size, color: "Alt", stock: Math.max(2, stock - 2), priceNgn }
            ],
            createdAt: now,
            updatedAt: now
          }
        },
        { upsert: true }
      );
    }
  },

  async down(db) {
    await db.collection("products").deleteMany({ slug: { $in: productSeeds.map((entry) => entry[0]) } });
  }
};
