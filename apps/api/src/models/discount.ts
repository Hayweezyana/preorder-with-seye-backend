import { Schema, model, type InferSchemaType } from "mongoose";

const discountSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    code: { type: String, required: true },
    type: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrderNgn: { type: Number, default: 0 },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null }
  },
  { timestamps: true }
);

discountSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export type DiscountDocument = InferSchemaType<typeof discountSchema>;
export const DiscountModel = model("Discount", discountSchema);
