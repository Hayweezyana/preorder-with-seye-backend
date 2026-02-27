import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { PaymentModel } from "../models/payment.js";
import { OrderModel } from "../models/order.js";
import { ProductModel } from "../models/catalog.js";
import { CartModel } from "../models/cart.js";
import { UserModel } from "../models/user.js";
import { enqueueOrderStatusNotification } from "../services/notificationQueue.js";
import { verifyPaystackTransaction, verifyPaystackWebhookSignature } from "../services/paystack.js";
import { resolveTenantId } from "../services/tenant.js";
import type { TenantRequest } from "../middleware/tenant.js";
import type { AuthRequest } from "../middleware/auth.js";

export const paymentsRouter = Router();

async function finalizeSuccessfulPayment(reference: string, metadata: Record<string, unknown>) {
  const payment = await PaymentModel.findOne({ providerRef: reference });
  if (!payment) {
    throw new Error("Payment reference not found");
  }

  const order = await OrderModel.findById(payment.orderId);
  if (!order) {
    throw new Error("Order not found for payment");
  }

  if (payment.status === "success") {
    return { payment, order, idempotent: true as const };
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    payment.status = "success";
    payment.verifiedAt = new Date();
    payment.metadata = {
      ...(payment.metadata ?? {}),
      ...metadata
    };
    await payment.save({ session });

    order.status = "paid";
    order.timeline.push({
      status: "paid",
      note: "Payment confirmed.",
      actor: "system",
      at: new Date()
    });
    await order.save({ session });

    for (const line of order.lines) {
      const updated = await ProductModel.updateOne(
        {
          _id: line.productId,
          tenantId: order.tenantId,
          "variants._id": line.variantId,
          "variants.stock": { $gte: line.quantity }
        },
        {
          $inc: {
            "variants.$.stock": -line.quantity
          }
        },
        { session }
      );

      if (updated.modifiedCount !== 1) {
        throw new Error(`Failed to decrement stock for product ${line.productId.toString()}`);
      }
    }

    await CartModel.updateOne(
      { tenantId: order.tenantId, userId: order.userId },
      { $set: { lines: [] } },
      { session }
    );

    await session.commitTransaction();

    const customer = await UserModel.findById(order.userId).select({ email: 1, firstName: 1, lastName: 1 }).lean();
    if (customer?.email) {
      await enqueueOrderStatusNotification({
        tenantId: order.tenantId.toString(),
        userId: order.userId.toString(),
        email: customer.email,
        customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim(),
        orderId: order._id.toString(),
        orderRef: order.orderRef,
        status: "paid",
        note: "Payment confirmed."
      });
    }

    return { payment, order, idempotent: false as const };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

paymentsRouter.post("/paystack/webhook", async (req, res) => {
  const signature = req.header("x-paystack-signature");
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  if (!verifyPaystackWebhookSignature(rawBody, signature)) {
    res.status(401).json({ message: "Invalid webhook signature" });
    return;
  }

  const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf-8")) : req.body;
  if (payload.event !== "charge.success") {
    res.status(200).json({ acknowledged: true });
    return;
  }

  const reference = payload.data?.reference as string | undefined;
  if (!reference) {
    res.status(400).json({ message: "Missing payment reference" });
    return;
  }

  try {
    const result = await finalizeSuccessfulPayment(reference, {
      source: "webhook",
      gatewayResponse: payload.data?.gateway_response,
      paidAt: payload.data?.paid_at
    });

    res.status(200).json({ acknowledged: true, idempotent: result.idempotent });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("not found")) {
      res.status(404).json({ message });
      return;
    }
    res.status(500).json({ message: "Webhook processing failed", detail: message });
  }
});

paymentsRouter.get("/paystack/callback", async (req, res) => {
  const reference = req.query.reference;
  if (typeof reference !== "string" || reference.length === 0) {
    res.status(400).json({ message: "Missing payment reference" });
    return;
  }

  try {
    const verified = await verifyPaystackTransaction(reference);

    if (verified.status !== "success") {
      res.redirect(`${env.CLIENT_CHECKOUT_FAILURE_URL}?ref=${encodeURIComponent(reference)}`);
      return;
    }

    const { order } = await finalizeSuccessfulPayment(reference, {
      source: "callback",
      gatewayResponse: verified.gateway_response,
      paidAt: verified.paid_at
    });

    const target = `${env.CLIENT_CHECKOUT_SUCCESS_URL}?ref=${encodeURIComponent(reference)}&orderRef=${encodeURIComponent(order.orderRef)}`;
    res.redirect(target);
  } catch (error) {
    res.redirect(`${env.CLIENT_CHECKOUT_FAILURE_URL}?ref=${encodeURIComponent(reference)}`);
  }
});

paymentsRouter.get("/:ref/status", async (req: TenantRequest, res) => {
  const reference = String(req.params.ref);
  const tenantId = await resolveTenantId(req.tenantId!);
  let payment = await PaymentModel.findOne({ tenantId, providerRef: reference }).lean();

  if (!payment) {
    res.status(404).json({ message: "Payment not found" });
    return;
  }

  if (payment.status !== "success") {
    try {
      const verified = await verifyPaystackTransaction(reference);
      if (verified.status === "success") {
        const finalized = await finalizeSuccessfulPayment(reference, {
          source: "status_poll",
          gatewayResponse: verified.gateway_response,
          paidAt: verified.paid_at
        });
        payment = finalized.payment.toObject();
      }
    } catch {
      // keep current status response if upstream verification fails
    }
  }

  res.json({
    paymentRef: payment.providerRef,
    status: payment.status,
    verifiedAt: payment.verifiedAt
  });
});

paymentsRouter.get("/:ref/order", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const payment = await PaymentModel.findOne({ tenantId, providerRef: req.params.ref }).lean();

  if (!payment) {
    res.status(404).json({ message: "Payment not found" });
    return;
  }

  if (req.claims?.role === "customer" && payment.userId.toString() !== req.claims.userId) {
    res.status(403).json({ message: "Order access denied" });
    return;
  }

  const order = await OrderModel.findById(payment.orderId).lean();
  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  res.json({
    paymentRef: payment.providerRef,
    orderId: order._id.toString(),
    orderRef: order.orderRef,
    status: order.status
  });
});
