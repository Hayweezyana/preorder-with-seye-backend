module.exports = {
  async up(db) {
    await db.createCollection("customeraddresses").catch(() => undefined);
    await db.collection("customeraddresses").createIndex({ tenantId: 1, userId: 1, createdAt: -1 });
    await db.collection("customeraddresses").createIndex(
      { tenantId: 1, userId: 1, isDefault: 1 },
      { unique: true, partialFilterExpression: { isDefault: true } }
    );
  },

  async down(db) {
    await db.collection("customeraddresses").drop().catch(() => undefined);
  }
};
