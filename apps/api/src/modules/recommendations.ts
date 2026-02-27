import { Router } from "express";
import { z } from "zod";
import { requireCustomer, type AuthRequest } from "../middleware/auth.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";
import { CustomerEventModel } from "../models/customerEvent.js";
import { ProductModel } from "../models/catalog.js";
import { WishlistModel } from "../models/wishlist.js";
import { OrderModel } from "../models/order.js";

export const recommendationsRouter = Router();

const searchEventSchema = z.object({
  term: z.string().min(2).max(80)
});

recommendationsRouter.use(requireCustomer);

recommendationsRouter.post("/events/search", async (req: AuthRequest, res) => {
  const parsed = searchEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid search event payload", issues: parsed.error.issues });
    return;
  }
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);
  await CustomerEventModel.create({
    tenantId,
    userId,
    type: "search",
    term: parsed.data.term.trim()
  });
  res.status(201).json({ ok: true });
});

recommendationsRouter.get("/me", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(req.claims!.userId);

  const [recentEvents, wishlist, userOrders, paidOrders] = await Promise.all([
    CustomerEventModel.find({ tenantId, userId }).sort({ createdAt: -1 }).limit(80).lean(),
    WishlistModel.find({ tenantId, userId }).sort({ lastViewedAt: -1 }).limit(30).lean(),
    OrderModel.find({ tenantId, userId, status: { $in: ["paid", "shipped", "delivered"] } })
      .sort({ createdAt: -1 })
      .limit(80)
      .lean(),
    OrderModel.find({ tenantId, status: { $in: ["paid", "shipped", "delivered"] } })
      .sort({ createdAt: -1 })
      .limit(400)
      .lean()
  ]);

  const viewedProductIds = wishlist.map((entry) => entry.productId.toString());
  const searchTerms = recentEvents
    .filter((event) => event.type === "search" && event.term)
    .map((event) => String(event.term).toLowerCase())
    .slice(0, 20);

  const allProducts = await ProductModel.find({ tenantId, active: true })
    .select({ slug: 1, name: 1, description: 1, imageUrl: 1, imageFit: 1, imagePublicId: 1, images: 1, variants: 1, categoryId: 1 })
    .lean();

  const productScore = new Map<string, number>();
  const categoryScore = new Map<string, number>();
  const now = Date.now();

  for (const order of userOrders) {
    const daysSinceOrder = Math.max(1, (now - new Date(order.createdAt).getTime()) / (1000 * 60 * 60 * 24));
    const recencyWeight = 100 / daysSinceOrder;
    for (const line of order.lines) {
      const id = line.productId.toString();
      const monetary = line.quantity * line.unitPriceNgn;
      const score = recencyWeight + line.quantity * 3 + monetary * 0.0002;
      productScore.set(id, (productScore.get(id) ?? 0) + score);
    }
  }

  const productsById = new Map(allProducts.map((product) => [product._id.toString(), product]));
  for (const [id, score] of productScore.entries()) {
    const product = productsById.get(id);
    if (!product) continue;
    const categoryId = product.categoryId.toString();
    categoryScore.set(categoryId, (categoryScore.get(categoryId) ?? 0) + score);
  }

  const globalPopularity = new Map<string, number>();
  for (const order of paidOrders) {
    for (const line of order.lines) {
      const id = line.productId.toString();
      globalPopularity.set(id, (globalPopularity.get(id) ?? 0) + line.quantity);
    }
  }

  const viewedSet = new Set(viewedProductIds);
  const scoredProducts = allProducts.map((product) => {
    const id = product._id.toString();
    const categoryId = product.categoryId.toString();
    const nameLower = product.name.toLowerCase();
    const descriptionLower = String(product.description ?? "").toLowerCase();
    const searchBoost = searchTerms.reduce(
      (sum, term) => sum + (nameLower.includes(term) || descriptionLower.includes(term) ? 20 : 0),
      0
    );
    const viewBoost = viewedSet.has(id) ? 35 : 0;
    const categoryBoost = (categoryScore.get(categoryId) ?? 0) * 0.25;
    const rfmBoost = productScore.get(id) ?? 0;
    const popularityBoost = (globalPopularity.get(id) ?? 0) * 1.2;
    const stockBoost = product.variants.some((variant) => variant.stock > 0) ? 10 : -20;
    const score = rfmBoost + categoryBoost + searchBoost + viewBoost + popularityBoost + stockBoost;
    return { product, score };
  });

  const unique = scoredProducts
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map((entry) => entry.product);

  res.json(
    unique.map((product) => ({
      id: product._id.toString(),
      slug: product.slug,
      name: product.name,
      categoryId: product.categoryId.toString(),
      priceNgn: product.variants[0]?.priceNgn ?? 0,
      imageUrl: product.images?.[0]?.url ?? product.imageUrl,
      imageFit: product.images?.[0]?.fit ?? product.imageFit ?? "contain",
      inStock: product.variants.some((variant) => variant.stock > 0)
    }))
  );
});
