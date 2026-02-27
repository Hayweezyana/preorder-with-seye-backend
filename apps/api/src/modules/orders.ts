import { Router } from "express";
import { requireCustomer, type AuthRequest } from "../middleware/auth.js";
import type { TenantRequest } from "../middleware/tenant.js";
import { OrderModel } from "../models/order.js";
import { UserModel } from "../models/user.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";

export const ordersRouter = Router();

ordersRouter.post("/", (_req, res) => {
  res.status(405).json({ message: "Use /checkout/initialize to create orders." });
});

ordersRouter.get("/me", requireCustomer, async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);

  const orders = await OrderModel.find({ tenantId, userId }).sort({ createdAt: -1 }).lean();
  res.json(
    orders.map((order) => ({
      id: order._id.toString(),
      orderRef: order.orderRef,
      status: order.status,
      totalNgn: order.totalNgn,
      createdAt: order.createdAt
    }))
  );
});

ordersRouter.get("/me/:id", requireCustomer, async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);

  const order = await OrderModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId, userId }).lean();
  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  res.json({
    id: order._id.toString(),
    orderRef: order.orderRef,
    status: order.status,
    trackingNumber: order.trackingNumber,
    totalNgn: order.totalNgn,
    createdAt: order.createdAt,
    items: order.lines,
    timeline: order.timeline ?? []
  });
});

ordersRouter.get("/track", async (req: TenantRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const orderRef = typeof req.query.orderRef === "string" ? req.query.orderRef.trim() : "";
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";

  if (!orderRef || !email) {
    res.status(400).json({ message: "orderRef and email are required" });
    return;
  }

  const customer = await UserModel.findOne({ tenantId, email }).lean();
  if (!customer) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  const order = await OrderModel.findOne({
    tenantId,
    userId: customer._id,
    orderRef: { $regex: `^${orderRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" }
  }).lean();
  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  res.json({
    id: order._id.toString(),
    orderRef: order.orderRef,
    status: order.status,
    trackingNumber: order.trackingNumber,
    createdAt: order.createdAt,
    timeline: order.timeline ?? []
  });
});
