import { Schema, model, type InferSchemaType } from "mongoose";

const inventoryLedgerSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, required: true, index: true },
    operation: { type: String, enum: ["add", "remove", "adjust"], required: true },
    delta: { type: Number, required: true },
    previousStock: { type: Number, required: true, min: 0 },
    nextStock: { type: Number, required: true, min: 0 },
    note: { type: String, default: null },
    actorId: { type: String, required: true },
    actorRole: { type: String, required: true }
  },
  { timestamps: true }
);

inventoryLedgerSchema.index({ tenantId: 1, productId: 1, variantId: 1, createdAt: -1 });

export type InventoryLedgerDocument = InferSchemaType<typeof inventoryLedgerSchema>;
export const InventoryLedgerModel = model("InventoryLedger", inventoryLedgerSchema);
