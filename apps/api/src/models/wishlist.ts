import { Schema, model, type InferSchemaType } from "mongoose";

const wishlistSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    lastViewedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

wishlistSchema.index({ tenantId: 1, userId: 1, productId: 1 }, { unique: true });

export type WishlistDocument = InferSchemaType<typeof wishlistSchema>;
export const WishlistModel = model("Wishlist", wishlistSchema);
