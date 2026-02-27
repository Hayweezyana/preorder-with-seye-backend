module.exports = {
  async up(db) {
    await db.createCollection("storebranches").catch(() => undefined);
    await db.createCollection("campaigns").catch(() => undefined);
    await db.createCollection("discounts").catch(() => undefined);
    await db.createCollection("trackingevents").catch(() => undefined);

    await db.collection("storebranches").createIndex({ tenantId: 1, code: 1 }, { unique: true });
    await db.collection("campaigns").createIndex({ tenantId: 1, createdAt: -1 });
    await db.collection("discounts").createIndex({ tenantId: 1, code: 1 }, { unique: true });
    await db.collection("trackingevents").createIndex({ tenantId: 1, orderId: 1, eventAt: -1 });
    await db.collection("trackingevents").createIndex({ tenantId: 1, provider: 1, externalTrackingId: 1 });
  },

  async down(db) {
    await db.collection("trackingevents").drop().catch(() => undefined);
    await db.collection("discounts").drop().catch(() => undefined);
    await db.collection("campaigns").drop().catch(() => undefined);
    await db.collection("storebranches").drop().catch(() => undefined);
  }
};
