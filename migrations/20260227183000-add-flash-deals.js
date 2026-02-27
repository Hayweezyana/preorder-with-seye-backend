module.exports = {
  async up(db) {
    await db.createCollection("flashdeals").catch(() => undefined);
    await db.collection("flashdeals").createIndex({ tenantId: 1, startAt: -1, endAt: -1 });
  },

  async down(db) {
    await db.collection("flashdeals").drop().catch(() => undefined);
  }
};
