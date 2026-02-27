module.exports = {
  async up(db) {
    await db.createCollection("customerevents").catch(() => undefined);
    await db.collection("customerevents").createIndex({ tenantId: 1, userId: 1, createdAt: -1 });
    await db.collection("customerevents").createIndex({ tenantId: 1, type: 1, term: 1 });
    await db.collection("customerevents").createIndex({ tenantId: 1, productId: 1 });
  },

  async down(db) {
    await db.collection("customerevents").drop().catch(() => undefined);
  }
};
