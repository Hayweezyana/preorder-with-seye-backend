import { Schema, model, type InferSchemaType } from "mongoose";

const customerNotificationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    type: { type: String, enum: ["low_stock", "restock"], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

customerNotificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export type CustomerNotificationDocument = InferSchemaType<typeof customerNotificationSchema>;
export const CustomerNotificationModel = model("CustomerNotification", customerNotificationSchema);
