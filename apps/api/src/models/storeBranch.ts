import { Schema, model, type InferSchemaType } from "mongoose";

const storeBranchSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    phone: { type: String, required: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

storeBranchSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export type StoreBranchDocument = InferSchemaType<typeof storeBranchSchema>;
export const StoreBranchModel = model("StoreBranch", storeBranchSchema);
