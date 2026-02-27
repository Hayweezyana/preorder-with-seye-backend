import { Router } from "express";
import { requireCustomer, type AuthRequest } from "../middleware/auth.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";
import { CustomerNotificationModel } from "../models/customerNotification.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireCustomer);

notificationsRouter.get("/me", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const rows = await CustomerNotificationModel.find({ tenantId, userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json(
    rows.map((row) => ({
      id: row._id.toString(),
      type: row.type,
      title: row.title,
      message: row.message,
      readAt: row.readAt,
      createdAt: row.createdAt
    }))
  );
});

notificationsRouter.patch("/me/:id/read", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const notification = await CustomerNotificationModel.findOneAndUpdate(
    { _id: toObjectId(String(req.params.id)), tenantId, userId },
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();
  if (!notification) {
    res.status(404).json({ message: "Notification not found" });
    return;
  }
  res.json({ id: notification._id.toString(), readAt: notification.readAt });
});
