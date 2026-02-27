import { Schema, model, type InferSchemaType } from "mongoose";

const orderLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceNgn: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const statusEventSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "shipped", "delivered", "cancelled"],
      required: true
    },
    note: { type: String, default: "" },
    trackingNumber: { type: String, default: null },
    actor: { type: String, default: "system" },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderRef: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "paid", "shipped", "delivered", "cancelled"],
      default: "pending"
    },
    currency: { type: String, default: "NGN" },
    subtotalNgn: { type: Number, required: true },
    shippingNgn: { type: Number, required: true },
    totalNgn: { type: Number, required: true },
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true }
    },
    trackingNumber: { type: String, default: null },
    fulfillmentBranchId: { type: Schema.Types.ObjectId, ref: "StoreBranch", default: null, index: true },
    lines: { type: [orderLineSchema], default: [] },
    timeline: { type: [statusEventSchema], default: [] }
  },
  { timestamps: true }
);

orderSchema.index({ tenantId: 1, orderRef: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export type OrderDocument = InferSchemaType<typeof orderSchema>;
export const OrderModel = model("Order", orderSchema);
