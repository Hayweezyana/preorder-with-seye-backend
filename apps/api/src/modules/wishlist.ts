import { Router } from "express";
import { requireCustomer, type AuthRequest } from "../middleware/auth.js";
import { resolveTenantId } from "../services/tenant.js";
import { WishlistModel } from "../models/wishlist.js";
import { ProductModel } from "../models/catalog.js";
import { toObjectId } from "../utils/ids.js";

export const wishlistRouter = Router();

wishlistRouter.use(requireCustomer);

wishlistRouter.get("/", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);

  const rows = await WishlistModel.find({ tenantId, userId }).sort({ updatedAt: -1 }).lean();
  const productIds = rows.map((row) => row.productId);
  const products = await ProductModel.find({ _id: { $in: productIds }, tenantId })
    .select({ name: 1, slug: 1, imageUrl: 1, imageFit: 1, variants: 1 })
    .lean();
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));

  res.json(
    rows
      .map((row) => {
        const product = productMap.get(row.productId.toString());
        if (!product) return null;
        return {
          id: row._id.toString(),
          productId: row.productId.toString(),
          product: {
            id: product._id.toString(),
            slug: product.slug,
            name: product.name,
            imageUrl: product.imageUrl,
            imageFit: product.imageFit ?? "contain",
            priceNgn: product.variants[0]?.priceNgn ?? 0,
            inStock: product.variants.some((variant) => variant.stock > 0)
          },
          lastViewedAt: row.lastViewedAt
        };
      })
      .filter(Boolean)
  );
});

wishlistRouter.post("/track-view", async (req: AuthRequest, res) => {
  const productId = typeof req.body?.productId === "string" ? req.body.productId : "";
  if (!productId) {
    res.status(400).json({ message: "productId is required" });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  const product = await ProductModel.findOne({ _id: toObjectId(productId), tenantId }).lean();
  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }

  const row = await WishlistModel.findOneAndUpdate(
    { tenantId, userId, productId: product._id },
    { $set: { lastViewedAt: new Date() } },
    { upsert: true, new: true }
  );

  res.status(201).json({ id: row._id.toString(), productId: product._id.toString() });
});

wishlistRouter.delete("/:id", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  await WishlistModel.deleteOne({ _id: toObjectId(String(req.params.id)), tenantId, userId });
  res.status(204).send();
});
