import { Router } from "express";
import { z } from "zod";
import { requireCustomer, type AuthRequest } from "../middleware/auth.js";
import { CustomerAddressModel } from "../models/customerAddress.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";

export const addressesRouter = Router();

const addressUpsertSchema = z.object({
  label: z.string().min(2).max(40),
  recipientName: z.string().min(2).max(80),
  phone: z.string().min(7).max(20),
  addressLine1: z.string().min(5).max(200),
  addressLine2: z.string().max(200).optional(),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(80),
  isDefault: z.boolean().optional()
});

function serializeAddress(address: {
  _id: { toString(): string };
  label: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  isDefault: boolean;
}) {
  return {
    id: address._id.toString(),
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? "",
    city: address.city,
    state: address.state,
    isDefault: address.isDefault
  };
}

addressesRouter.use(requireCustomer);

addressesRouter.get("/", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const addresses = await CustomerAddressModel.find({ tenantId, userId }).sort({ isDefault: -1, createdAt: -1 });
  res.json(addresses.map((address) => serializeAddress(address)));
});

addressesRouter.post("/", async (req: AuthRequest, res) => {
  const parsed = addressUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid address payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const existingCount = await CustomerAddressModel.countDocuments({ tenantId, userId });
  const shouldSetDefault = parsed.data.isDefault ?? existingCount === 0;

  if (shouldSetDefault) {
    await CustomerAddressModel.updateMany({ tenantId, userId, isDefault: true }, { $set: { isDefault: false } });
  }

  const address = await CustomerAddressModel.create({
    tenantId,
    userId,
    ...parsed.data,
    addressLine2: parsed.data.addressLine2 ?? "",
    isDefault: shouldSetDefault
  });

  res.status(201).json(serializeAddress(address));
});

addressesRouter.patch("/:id", async (req: AuthRequest, res) => {
  const parsed = addressUpsertSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid address payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const address = await CustomerAddressModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId, userId });
  if (!address) {
    res.status(404).json({ message: "Address not found" });
    return;
  }

  if (parsed.data.isDefault === true) {
    await CustomerAddressModel.updateMany({ tenantId, userId, isDefault: true }, { $set: { isDefault: false } });
    address.isDefault = true;
  } else if (parsed.data.isDefault === false) {
    address.isDefault = false;
  }

  if (parsed.data.label !== undefined) address.label = parsed.data.label;
  if (parsed.data.recipientName !== undefined) address.recipientName = parsed.data.recipientName;
  if (parsed.data.phone !== undefined) address.phone = parsed.data.phone;
  if (parsed.data.addressLine1 !== undefined) address.addressLine1 = parsed.data.addressLine1;
  if (parsed.data.addressLine2 !== undefined) address.addressLine2 = parsed.data.addressLine2;
  if (parsed.data.city !== undefined) address.city = parsed.data.city;
  if (parsed.data.state !== undefined) address.state = parsed.data.state;

  await address.save();

  if (!address.isDefault) {
    const hasDefault = await CustomerAddressModel.exists({ tenantId, userId, isDefault: true });
    if (!hasDefault) {
      const latestAddress = await CustomerAddressModel.findOne({ tenantId, userId }).sort({ createdAt: -1 });
      if (latestAddress) {
        latestAddress.isDefault = true;
        await latestAddress.save();
      }
    }
  }

  res.json(serializeAddress(address));
});

addressesRouter.delete("/:id", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const address = await CustomerAddressModel.findOneAndDelete({ _id: toObjectId(String(req.params.id)), tenantId, userId });
  if (!address) {
    res.status(404).json({ message: "Address not found" });
    return;
  }

  if (address.isDefault) {
    const replacement = await CustomerAddressModel.findOne({ tenantId, userId }).sort({ createdAt: -1 });
    if (replacement) {
      replacement.isDefault = true;
      await replacement.save();
    }
  }

  res.status(204).send();
});
