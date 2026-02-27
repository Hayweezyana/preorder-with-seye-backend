import { Schema, model, type InferSchemaType } from "mongoose";

const cartLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceNgn: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

const cartSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    sessionId: { type: String, default: null, index: true },
    lines: { type: [cartLineSchema], default: [] }
  },
  { timestamps: true }
);

cartSchema.index({ tenantId: 1, userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } });
cartSchema.index({ tenantId: 1, sessionId: 1 }, { unique: true, partialFilterExpression: { sessionId: { $type: "string" } } });

export type CartDocument = InferSchemaType<typeof cartSchema>;
export const CartModel = model("Cart", cartSchema);
