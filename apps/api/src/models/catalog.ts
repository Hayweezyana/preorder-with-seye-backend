import { Schema, model, type InferSchemaType } from "mongoose";

const categorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true }
  },
  { timestamps: true }
);

categorySchema.index({ tenantId: 1, slug: 1 }, { unique: true });

const variantSchema = new Schema(
  {
    sku: { type: String, required: true },
    size: { type: String, required: true },
    color: { type: String, required: true },
    stock: { type: Number, required: true, min: 0 },
    priceNgn: { type: Number, required: true, min: 0 }
  },
  { _id: true }
);

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: null },
    fit: { type: String, enum: ["contain", "cover"], default: "contain" }
  },
  { _id: false }
);

const productSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    imageUrl: { type: String, required: true },
    imagePublicId: { type: String, default: null },
    imageFit: { type: String, enum: ["contain", "cover"], default: "contain" },
    images: { type: [imageSchema], default: [] },
    active: { type: Boolean, default: true },
    variants: { type: [variantSchema], default: [] }
  },
  { timestamps: true }
);

productSchema.index({ tenantId: 1, slug: 1 }, { unique: true });

export type CategoryDocument = InferSchemaType<typeof categorySchema>;
export type ProductDocument = InferSchemaType<typeof productSchema>;
export const CategoryModel = model("Category", categorySchema);
export const ProductModel = model("Product", productSchema);
