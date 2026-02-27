import { Types } from "mongoose";
import { TenantModel } from "../models/tenant.js";

export async function resolveTenantId(rawTenant: string) {
  if (Types.ObjectId.isValid(rawTenant)) {
    return new Types.ObjectId(rawTenant);
  }

  const tenant = await TenantModel.findOne({ slug: rawTenant }).select({ _id: 1 }).lean();
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  return tenant._id;
}
