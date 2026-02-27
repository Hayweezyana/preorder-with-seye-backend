import { Router } from "express";
import { Types } from "mongoose";
import { CategoryModel, ProductModel } from "../models/catalog.js";
import { resolveTenantId } from "../services/tenant.js";
import type { TenantRequest } from "../middleware/tenant.js";
import type { AuthRequest } from "../middleware/auth.js";
import { WishlistModel } from "../models/wishlist.js";
import { CustomerEventModel } from "../models/customerEvent.js";
import { toObjectId } from "../utils/ids.js";

export const productsRouter = Router();
export const categoriesRouter = Router();

function parseOptionalNumber(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const raw = String(value).trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

productsRouter.get("/", async (req: TenantRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const search = String(req.query.search ?? "").trim();
  const categoryFilter = String(req.query.category ?? "").trim();
  const minPrice = parseOptionalNumber(req.query.minPrice);
  const maxPrice = parseOptionalNumber(req.query.maxPrice);

  let categoryId: Types.ObjectId | undefined;
  if (categoryFilter) {
    if (Types.ObjectId.isValid(categoryFilter)) {
      categoryId = new Types.ObjectId(categoryFilter);
    } else {
      const category = await CategoryModel.findOne({ tenantId, slug: categoryFilter }).select({ _id: 1 }).lean();
      if (!category) {
        res.json([]);
        return;
      }
      categoryId = category._id;
    }
  }

  const query: Record<string, unknown> = {
    tenantId,
    active: true
  };
  if (categoryId) {
    query.categoryId = categoryId;
  }
  if (search) {
    query.$or = [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }];
  }

  const products = await ProductModel.find(query)
    .select({
      slug: 1,
      name: 1,
      imageUrl: 1,
      imagePublicId: 1,
      imageFit: 1,
      images: 1,
      variants: 1,
      categoryId: 1
    })
    .lean();

  const rows = products
    .map((product) => {
      const images =
        product.images && product.images.length > 0
          ? product.images
          : [
              {
                url: product.imageUrl,
                publicId: product.imagePublicId ?? null,
                fit: product.imageFit ?? "contain"
              }
            ];
      const basePrice = product.variants[0]?.priceNgn ?? 0;
      return {
        id: product._id.toString(),
        tenantId: tenantId.toString(),
        slug: product.slug,
        name: product.name,
        categoryId: product.categoryId.toString(),
        priceNgn: basePrice,
        imageUrl: images[0].url,
        imageFit: images[0].fit ?? "contain",
        images: images.map((image) => ({
          url: image.url,
          publicId: image.publicId ?? null,
          fit: image.fit ?? "contain"
        })),
        inStock: product.variants.some((variant) => variant.stock > 0)
      };
    })
    .filter((product) => (minPrice !== undefined ? product.priceNgn >= minPrice : true))
    .filter((product) => (maxPrice !== undefined ? product.priceNgn <= maxPrice : true));

  res.json(
    rows.map((product) => ({
      id: product.id,
      tenantId: product.tenantId,
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId,
      priceNgn: product.priceNgn,
      imageUrl: product.imageUrl,
      imageFit: product.imageFit,
      images: product.images,
      inStock: product.inStock
    }))
  );
});

productsRouter.get("/:slug", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const product = await ProductModel.findOne({ tenantId, slug: req.params.slug }).lean();

  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }

  if (req.claims?.role === "customer") {
    const userId = toObjectId(req.claims.userId);
    await WishlistModel.findOneAndUpdate(
      { tenantId, userId, productId: product._id },
      { $set: { lastViewedAt: new Date() } },
      { upsert: true, new: true }
    );
    await CustomerEventModel.create({
      tenantId,
      userId,
      type: "view",
      productId: product._id
    });
  }

  res.json({
    id: product._id.toString(),
    tenantId: tenantId.toString(),
    slug: product.slug,
    name: product.name,
    description: product.description,
    imageUrl:
      product.images && product.images.length > 0
        ? product.images[0].url
        : product.imageUrl,
    imageFit:
      product.images && product.images.length > 0
        ? (product.images[0].fit ?? "contain")
        : (product.imageFit ?? "contain"),
    images:
      product.images && product.images.length > 0
        ? product.images.map((image) => ({
            url: image.url,
            publicId: image.publicId ?? null,
            fit: image.fit ?? "contain"
          }))
        : [
            {
              url: product.imageUrl,
              publicId: product.imagePublicId ?? null,
              fit: product.imageFit ?? "contain"
            }
          ],
    variants: product.variants.map((variant) => ({
      id: variant._id.toString(),
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      priceNgn: variant.priceNgn
    }))
  });
});

categoriesRouter.get("/", async (req: TenantRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const categories = await CategoryModel.find({ tenantId }).select({ name: 1, slug: 1 }).lean();
  res.json(categories.map((category) => ({ id: category._id.toString(), name: category.name, slug: category.slug })));
});
