import { Router } from "express";
import mongoose from "mongoose";
import { checkoutInitSchema } from "@sws/shared-types";
import type { AuthRequest } from "../middleware/auth.js";
import { requireCustomer } from "../middleware/auth.js";
import { CartModel } from "../models/cart.js";
import { OrderModel } from "../models/order.js";
import { PaymentModel } from "../models/payment.js";
import { CustomerAddressModel } from "../models/customerAddress.js";
import { resolveTenantId } from "../services/tenant.js";
import { initializePaystackTransaction } from "../services/paystack.js";
import { calculateCartTotals } from "../utils/cart.js";
import { toObjectId } from "../utils/ids.js";

export const checkoutRouter = Router();

checkoutRouter.post("/initialize", requireCustomer, async (req: AuthRequest, res) => {
  const parsed = checkoutInitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid checkout payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);

  const cart = await CartModel.findOne({ tenantId, userId });
  if (!cart || cart.lines.length === 0) {
    res.status(409).json({ message: "Cart is empty" });
    return;
  }

  const totals = calculateCartTotals(cart);
  const orderRef = `SWS-${Date.now()}`;
  const paymentRef = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  let shippingAddress: { address: string; city: string; state: string };
  if (parsed.data.addressId) {
    const address = await CustomerAddressModel.findOne({
      _id: toObjectId(parsed.data.addressId),
      tenantId,
      userId
    }).lean();
    if (!address) {
      res.status(404).json({ message: "Address not found" });
      return;
    }
    shippingAddress = {
      address: `${address.addressLine1}${address.addressLine2 ? `, ${address.addressLine2}` : ""}`,
      city: address.city,
      state: address.state
    };
  } else if (parsed.data.shippingAddress && parsed.data.city && parsed.data.state) {
    shippingAddress = {
      address: parsed.data.shippingAddress,
      city: parsed.data.city,
      state: parsed.data.state
    };
  } else {
    res.status(400).json({ message: "Shipping address is required" });
    return;
  }

  const paystack = await initializePaystackTransaction({
    email: parsed.data.email,
    amountKobo: totals.totalNgn * 100,
    reference: paymentRef,
    metadata: {
      tenantId: tenantId.toString(),
      userId: userId.toString(),
      orderRef
    }
  });

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const [order] = await OrderModel.create(
      [
        {
          tenantId,
          userId,
          orderRef,
          status: "pending",
          subtotalNgn: totals.subtotalNgn,
          shippingNgn: totals.shippingNgn,
          totalNgn: totals.totalNgn,
          shippingAddress: {
            address: shippingAddress.address,
            city: shippingAddress.city,
            state: shippingAddress.state
          },
          timeline: [
            {
              status: "pending",
              note: "Order created and awaiting payment confirmation.",
              actor: "system",
              at: new Date()
            }
          ],
          lines: cart.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            name: line.name,
            quantity: line.quantity,
            unitPriceNgn: line.unitPriceNgn
          }))
        }
      ],
      { session }
    );

    await PaymentModel.create(
      [
        {
          tenantId,
          userId,
          orderId: order._id,
          provider: "paystack",
          providerRef: paymentRef,
          amountNgn: totals.totalNgn,
          status: "initialized",
          metadata: {
            accessCode: paystack.access_code,
            authorizationUrl: paystack.authorization_url
          }
        }
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      orderRef,
      paymentRef,
      authorizationUrl: paystack.authorization_url
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});
