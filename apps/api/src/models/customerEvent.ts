import { Schema, model, type InferSchemaType } from "mongoose";

const customerEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["search", "view"], required: true, index: true },
    term: { type: String, default: null, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null, index: true }
  },
  { timestamps: true }
);

customerEventSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export type CustomerEventDocument = InferSchemaType<typeof customerEventSchema>;
export const CustomerEventModel = model("CustomerEvent", customerEventSchema);
