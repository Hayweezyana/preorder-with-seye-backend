module.exports = {
  async up(db) {
    const duplicates = await db
      .collection("users")
      .aggregate([
        { $match: { phone: { $type: "string", $ne: "" } } },
        {
          $group: {
            _id: { tenantId: "$tenantId", phone: "$phone" },
            ids: { $push: "$_id" },
            count: { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ])
      .toArray();

    for (const group of duplicates) {
      const [, ...duplicateIds] = group.ids;
      for (const userId of duplicateIds) {
        await db.collection("users").updateOne(
          { _id: userId },
          {
            $set: {
              phone: `${group._id.phone}-dup-${String(userId).slice(-6)}`
            }
          }
        );
      }
    }

    await db.collection("users").createIndex({ tenantId: 1, phone: 1 }, { unique: true });
  },

  async down(db) {
    await db.collection("users").dropIndex("tenantId_1_phone_1").catch(() => undefined);
  }
};
