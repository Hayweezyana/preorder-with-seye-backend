module.exports = {
  async up(db) {
    await db.createCollection("adminauditlogs").catch(() => undefined);
    await db.createCollection("contentsettings").catch(() => undefined);

    await db.collection("adminauditlogs").createIndex({ tenantId: 1, createdAt: -1 });
    await db.collection("adminauditlogs").createIndex({ tenantId: 1, action: 1, createdAt: -1 });
    await db.collection("contentsettings").createIndex({ tenantId: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection("contentsettings").drop().catch(() => undefined);
    await db.collection("adminauditlogs").drop().catch(() => undefined);
  }
};
