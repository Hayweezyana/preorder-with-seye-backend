const { ObjectId } = require("mongodb");

module.exports = {
  async up(db) {
    const now = new Date();

    await db.createCollection("tenants").catch(() => undefined);
    await db.createCollection("users").catch(() => undefined);
    await db.createCollection("categories").catch(() => undefined);
    await db.createCollection("products").catch(() => undefined);
    await db.createCollection("carts").catch(() => undefined);
    await db.createCollection("orders").catch(() => undefined);
    await db.createCollection("payments").catch(() => undefined);

    await db.collection("tenants").createIndex({ slug: 1 }, { unique: true });
    await db.collection("users").createIndex({ tenantId: 1, email: 1 }, { unique: true });
    await db.collection("categories").createIndex({ tenantId: 1, slug: 1 }, { unique: true });
    await db.collection("products").createIndex({ tenantId: 1, slug: 1 }, { unique: true });
    await db.collection("orders").createIndex({ tenantId: 1, orderRef: 1 }, { unique: true });
    await db.collection("orders").createIndex({ tenantId: 1, userId: 1, createdAt: -1 });
    await db.collection("payments").createIndex({ tenantId: 1, providerRef: 1 }, { unique: true });

    const existingTenant = await db.collection("tenants").findOne({ slug: "tenant_demo" });
    let tenantId = existingTenant?._id;

    if (!tenantId) {
      const tenantInsert = await db.collection("tenants").insertOne({
        name: "Demo Store",
        slug: "tenant_demo",
        createdAt: now,
        updatedAt: now
      });
      tenantId = tenantInsert.insertedId;
    }

    const existingCategory = await db.collection("categories").findOne({ tenantId, slug: "fashion" });
    let categoryId = existingCategory?._id;

    if (!categoryId) {
      const categoryInsert = await db.collection("categories").insertOne({
        tenantId,
        name: "Fashion",
        slug: "fashion",
        createdAt: now,
        updatedAt: now
      });
      categoryId = categoryInsert.insertedId;
    }

    const existingProduct = await db.collection("products").findOne({ tenantId, slug: "seye-red-dress" });
    if (!existingProduct) {
      await db.collection("products").insertOne({
        tenantId,
        categoryId,
        slug: "seye-red-dress",
        name: "Seye Red Dress",
        description: "Elegant red dress for premium occasions.",
        imageUrl: "https://res.cloudinary.com/demo/image/upload/red-dress.jpg",
        active: true,
        variants: [
          { _id: new ObjectId(), sku: "SRD-M-RED", size: "M", color: "Red", stock: 8, priceNgn: 15000 },
          { _id: new ObjectId(), sku: "SRD-L-RED", size: "L", color: "Red", stock: 2, priceNgn: 15000 }
        ],
        createdAt: now,
        updatedAt: now
      });
    }
  },

  async down(db) {
    await db.collection("products").deleteMany({ slug: "seye-red-dress" });
    await db.collection("categories").deleteMany({ slug: "fashion" });
    await db.collection("tenants").deleteMany({ slug: "tenant_demo" });
  }
};
