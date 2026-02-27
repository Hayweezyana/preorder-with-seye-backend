import { Schema, model, type InferSchemaType } from "mongoose";

const paymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    provider: { type: String, enum: ["paystack"], default: "paystack" },
    providerRef: { type: String, required: true },
    status: { type: String, enum: ["initialized", "success", "failed", "refunded"], default: "initialized" },
    amountNgn: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    initializedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

paymentSchema.index({ tenantId: 1, providerRef: 1 }, { unique: true });

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model("Payment", paymentSchema);
