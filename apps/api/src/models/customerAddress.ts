import { Schema, model, type InferSchemaType } from "mongoose";

const customerAddressSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    label: { type: String, required: true, default: "Home" },
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String, default: "" },
    city: { type: String, required: true },
    state: { type: String, required: true },
    isDefault: { type: Boolean, default: false }
  },
  { timestamps: true }
);

customerAddressSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
customerAddressSchema.index(
  { tenantId: 1, userId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export type CustomerAddressDocument = InferSchemaType<typeof customerAddressSchema>;
export const CustomerAddressModel = model("CustomerAddress", customerAddressSchema);
