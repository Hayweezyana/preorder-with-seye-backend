module.exports = {
  async up(db) {
    await db.createCollection("inventoryledgers").catch(() => undefined);
    await db.collection("inventoryledgers").createIndex({ tenantId: 1, productId: 1, variantId: 1, createdAt: -1 });
  },

  async down(db) {
    await db.collection("inventoryledgers").drop().catch(() => undefined);
  }
};
