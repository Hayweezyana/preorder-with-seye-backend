import { Schema, model, type InferSchemaType } from "mongoose";

const flashDealSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    title: { type: String, required: true },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true, index: true },
    discountPercent: { type: Number, required: true, min: 1, max: 95 },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

flashDealSchema.index({ tenantId: 1, startAt: -1, endAt: -1 });

export type FlashDealDocument = InferSchemaType<typeof flashDealSchema>;
export const FlashDealModel = model("FlashDeal", flashDealSchema);
