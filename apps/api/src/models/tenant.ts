import { Schema, model, type InferSchemaType } from "mongoose";

const tenantSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }
  },
  { timestamps: true }
);

export type TenantDocument = InferSchemaType<typeof tenantSchema>;
export const TenantModel = model("Tenant", tenantSchema);
