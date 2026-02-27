module.exports = {
  async up(db) {
    await db.createCollection("wishlists").catch(() => undefined);
    await db.createCollection("customernotifications").catch(() => undefined);

    await db.collection("wishlists").createIndex({ tenantId: 1, userId: 1, productId: 1 }, { unique: true });
    await db.collection("customernotifications").createIndex({ tenantId: 1, userId: 1, createdAt: -1 });

    await db.collection("users").updateMany(
      { notificationsEnabled: { $exists: false } },
      { $set: { notificationsEnabled: true } }
    );
  },

  async down(db) {
    await db.collection("customernotifications").drop().catch(() => undefined);
    await db.collection("wishlists").drop().catch(() => undefined);
  }
};
