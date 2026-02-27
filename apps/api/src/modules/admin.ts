import { Router } from "express";
import {
  adminAccessLevelSchema,
  adminOrderStatusUpdateSchema,
  adminUserAccessLevelUpdateSchema,
  campaignCreateSchema,
  reportExportSchema
} from "@sws/shared-types";
import { z } from "zod";
import { requireAdmin, requirePermission, type AuthRequest } from "../middleware/auth.js";
import { OrderModel } from "../models/order.js";
import { UserModel } from "../models/user.js";
import { enqueueOrderStatusNotification } from "../services/notificationQueue.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";
import { resolvePermissions, resolveRole } from "../services/accessControl.js";
import { CategoryModel, ProductModel } from "../models/catalog.js";
import { env } from "../config/env.js";
import { createSignedUploadPayload } from "../services/cloudinary.js";
import { InventoryLedgerModel } from "../models/inventoryLedger.js";
import { StoreBranchModel } from "../models/storeBranch.js";
import { CampaignModel } from "../models/campaign.js";
import { DiscountModel } from "../models/discount.js";
import { TrackingEventModel } from "../models/trackingEvent.js";
import { WishlistModel } from "../models/wishlist.js";
import { CustomerNotificationModel } from "../models/customerNotification.js";
import { enqueueWishlistStockNotification } from "../services/notificationQueue.js";
import { FlashDealModel } from "../models/flashDeal.js";
import { AdminAuditLogModel } from "../models/adminAuditLog.js";
import { ContentSettingsModel } from "../models/contentSettings.js";

const inventoryOperationSchema = z.enum(["add", "remove", "adjust"]);
const inventoryAdjustmentSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  operation: inventoryOperationSchema,
  quantity: z.number().int().positive().optional(),
  targetStock: z.number().int().min(0).optional(),
  note: z.string().max(240).optional()
});

const productVariantInputSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(2),
  size: z.string().min(1),
  color: z.string().min(1),
  stock: z.number().int().min(0),
  priceNgn: z.number().int().min(0)
});

const productImageInputSchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1).optional(),
  fit: z.enum(["contain", "cover"]).default("contain")
});

const productUpsertSchema = z.object({
  categoryId: z.string().min(1),
  slug: z.string().min(2).optional(),
  name: z.string().min(2),
  description: z.string().min(10),
  imageUrl: z.string().url(),
  imagePublicId: z.string().min(1).optional(),
  imageFit: z.enum(["contain", "cover"]).default("contain"),
  images: z.array(productImageInputSchema).min(1).optional(),
  active: z.boolean().optional(),
  variants: z.array(productVariantInputSchema).min(1)
});
const productBulkCreateSchema = z.object({
  products: z.array(productUpsertSchema).min(1).max(200)
});
const productBulkCsvSchema = z.object({
  csv: z.string().min(1)
});

const cloudinarySignSchema = z.object({
  publicId: z.string().min(1).optional()
});
const categoryCreateSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).optional()
});
const adminUserProfileUpdateSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().min(7)
});
const storeBranchCreateSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  phone: z.string().min(7),
  active: z.boolean().optional()
});
const storeBranchUpdateSchema = storeBranchCreateSchema.partial();
const discountCreateSchema = z.object({
  code: z.string().min(3),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive(),
  minOrderNgn: z.number().min(0).optional(),
  maxUses: z.number().int().positive().optional(),
  active: z.boolean().optional()
});
const flashDealCreateSchema = z.object({
  title: z.string().min(3),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  discountPercent: z.number().int().min(1).max(95),
  productIds: z.array(z.string().min(1)).min(1),
  active: z.boolean().optional()
});
const orderTrackingEventSchema = z.object({
  provider: z.string().min(2),
  externalTrackingId: z.string().min(2),
  status: z.enum(["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception"]),
  location: z.string().min(2).optional(),
  message: z.string().min(2).optional(),
  eventAt: z.string().datetime().optional()
});
const contentSettingsUpdateSchema = z.object({
  heroTitle: z.string().min(3).max(120).optional(),
  heroSubtitle: z.string().min(5).max(240).optional(),
  heroCtaLabel: z.string().min(2).max(40).optional(),
  heroCtaPath: z.string().min(1).max(120).optional(),
  promoStripText: z.string().min(5).max(240).optional(),
  featuredCategorySlugs: z.array(z.string().min(2).max(80)).max(12).optional()
});

const allowedTransition: Record<string, string[]> = {
  pending: ["processing", "shipped", "cancelled"],
  processing: ["shipped", "cancelled"],
  paid: ["processing", "shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};

function canTransition(from: string, to: string) {
  if (from === to) {
    return true;
  }
  return (allowedTransition[from] ?? []).includes(to);
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      const nextChar = line[index + 1];
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function compactSkuToken(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 3))
    .join("");
}

function buildSku(name: string, color: string, size: string, index: number) {
  return `${compactSkuToken(name) || "PRD"}-${compactSkuToken(color) || "CLR"}-${compactSkuToken(size) || "SZ"}-${String(index + 1).padStart(2, "0")}`;
}

function resolveProductImages(input: {
  imageUrl: string;
  imagePublicId?: string | null;
  imageFit: "contain" | "cover";
  images?: Array<{ url: string; publicId?: string | null; fit?: "contain" | "cover" }>;
}) {
  if (input.images && input.images.length > 0) {
    return input.images.map((image) => ({
      url: image.url,
      publicId: image.publicId ?? null,
      fit: image.fit ?? "contain"
    }));
  }
  return [
    {
      url: input.imageUrl,
      publicId: input.imagePublicId ?? null,
      fit: input.imageFit
    }
  ];
}

async function logAdminAction(params: {
  tenantId: { toString(): string };
  req: AuthRequest;
  action: string;
  entityType: string;
  entityId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  if (!params.req.claims) {
    return;
  }
  await AdminAuditLogModel.create({
    tenantId: params.tenantId,
    actorUserId: toObjectId(params.req.claims.userId),
    actorRole: params.req.claims.role,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    message: params.message,
    metadata: params.metadata ?? {}
  });
}

async function notifyWishlistSubscribers(params: {
  tenantId: { toString(): string };
  productId: { toString(): string };
  productName: string;
  previousStock: number;
  currentStock: number;
}) {
  const lowStockThreshold = 3;
  const crossedToLow = params.previousStock > lowStockThreshold && params.currentStock > 0 && params.currentStock <= lowStockThreshold;
  const crossedToRestock = params.previousStock <= 0 && params.currentStock > 0;
  if (!crossedToLow && !crossedToRestock) {
    return;
  }

  const wishlists = await WishlistModel.find({
    tenantId: params.tenantId,
    productId: params.productId
  }).lean();
  if (wishlists.length === 0) {
    return;
  }

  const userIds = wishlists.map((entry) => entry.userId);
  const users = await UserModel.find({
    _id: { $in: userIds },
    notificationsEnabled: true
  })
    .select({ email: 1, firstName: 1 })
    .lean();

  const type = crossedToLow ? "low_stock" : "restock";
  await Promise.all(
    users.map(async (user) => {
      await CustomerNotificationModel.create({
        tenantId: params.tenantId,
        userId: user._id,
        productId: params.productId,
        type,
        title: type === "low_stock" ? "Low Stock Alert" : "Back in Stock",
        message:
          type === "low_stock"
            ? `${params.productName} is running low (${params.currentStock} left).`
            : `${params.productName} is back in stock (${params.currentStock} available).`
      });
      await enqueueWishlistStockNotification({
        email: user.email,
        firstName: user.firstName,
        productName: params.productName,
        type,
        currentStock: params.currentStock
      });
    })
  );
}

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.post("/media/sign-upload", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  try {
    const parsed = cloudinarySignSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid media sign payload", issues: parsed.error.issues });
      return;
    }

    const signed = createSignedUploadPayload({
      folder: env.CLOUDINARY_UPLOAD_FOLDER,
      publicId: parsed.data.publicId
    });

    res.json(signed);
  } catch (error) {
    res.status(503).json({ message: (error as Error).message });
  }
});

adminRouter.post("/categories", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = categoryCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid category payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const slug = parsed.data.slug ? slugify(parsed.data.slug) : slugify(parsed.data.name);
  const existing = await CategoryModel.findOne({ tenantId, slug }).lean();
  if (existing) {
    res.status(409).json({ message: "Category already exists" });
    return;
  }

  const category = await CategoryModel.create({
    tenantId,
    name: parsed.data.name,
    slug
  });

  res.status(201).json({
    id: category._id.toString(),
    name: category.name,
    slug: category.slug
  });
  await logAdminAction({
    tenantId,
    req,
    action: "category.create",
    entityType: "category",
    entityId: category._id.toString(),
    message: `Created category ${category.name}.`
  });
});

adminRouter.get("/products", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const products = await ProductModel.find({ tenantId })
    .sort({ createdAt: -1 })
    .lean();

  res.json(
    products.map((product) => ({
      id: product._id.toString(),
      categoryId: product.categoryId.toString(),
      slug: product.slug,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      imagePublicId: product.imagePublicId,
      imageFit: product.imageFit ?? "contain",
      images: resolveProductImages({
        imageUrl: product.imageUrl,
        imagePublicId: product.imagePublicId ?? undefined,
        imageFit: product.imageFit ?? "contain",
        images: product.images
      }),
      active: product.active,
      variants: product.variants.map((variant) => ({
        id: variant._id.toString(),
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
        priceNgn: variant.priceNgn
      }))
    }))
  );
});

adminRouter.get("/products/:id", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const product = await ProductModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId }).lean();
  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }

  res.json({
    id: product._id.toString(),
    categoryId: product.categoryId.toString(),
    slug: product.slug,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    imagePublicId: product.imagePublicId,
    imageFit: product.imageFit ?? "contain",
    images: resolveProductImages({
      imageUrl: product.imageUrl,
      imagePublicId: product.imagePublicId ?? undefined,
      imageFit: product.imageFit ?? "contain",
      images: product.images
    }),
    active: product.active,
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

adminRouter.post("/products", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = productUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid product payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const category = await CategoryModel.findOne({ _id: toObjectId(parsed.data.categoryId), tenantId }).lean();
  if (!category) {
    res.status(404).json({ message: "Category not found" });
    return;
  }

  const slug = parsed.data.slug ? slugify(parsed.data.slug) : slugify(parsed.data.name);

  const exists = await ProductModel.findOne({ tenantId, slug }).lean();
  if (exists) {
    res.status(409).json({ message: "Product slug already exists" });
    return;
  }

  const images = resolveProductImages(parsed.data);
  const primaryImage = images[0];
  const product = await ProductModel.create({
    tenantId,
    categoryId: category._id,
    slug,
    name: parsed.data.name,
    description: parsed.data.description,
    imageUrl: primaryImage.url,
    imagePublicId: primaryImage.publicId,
    imageFit: primaryImage.fit,
    images,
    active: parsed.data.active ?? true,
    variants: parsed.data.variants.map((variant) => ({
      _id: variant.id ? toObjectId(variant.id) : undefined,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      priceNgn: variant.priceNgn
    }))
  });

  res.status(201).json({ id: product._id.toString(), slug: product.slug });
  await logAdminAction({
    tenantId,
    req,
    action: "product.create",
    entityType: "product",
    entityId: product._id.toString(),
    message: `Created product ${product.name}.`
  });
});

adminRouter.patch("/products/:id", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = productUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid product payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const product = await ProductModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId });
  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }

  const category = await CategoryModel.findOne({ _id: toObjectId(parsed.data.categoryId), tenantId }).lean();
  if (!category) {
    res.status(404).json({ message: "Category not found" });
    return;
  }

  const nextSlug = parsed.data.slug ? slugify(parsed.data.slug) : slugify(parsed.data.name);
  const duplicate = await ProductModel.findOne({ tenantId, slug: nextSlug, _id: { $ne: product._id } }).lean();
  if (duplicate) {
    res.status(409).json({ message: "Product slug already exists" });
    return;
  }

  const images = resolveProductImages(parsed.data);
  const primaryImage = images[0];
  product.categoryId = category._id;
  product.slug = nextSlug;
  product.name = parsed.data.name;
  product.description = parsed.data.description;
  product.imageUrl = primaryImage.url;
  product.imagePublicId = primaryImage.publicId;
  product.imageFit = primaryImage.fit;
  product.set("images", images);
  product.active = parsed.data.active ?? true;
  product.set(
    "variants",
    parsed.data.variants.map((variant) => ({
      _id: variant.id ? toObjectId(variant.id) : undefined,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      priceNgn: variant.priceNgn
    }))
  );

  await product.save();

  res.json({ id: product._id.toString(), slug: product.slug });
  await logAdminAction({
    tenantId,
    req,
    action: "product.update",
    entityType: "product",
    entityId: product._id.toString(),
    message: `Updated product ${product.name}.`
  });
});

adminRouter.post("/products/bulk", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = productBulkCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid bulk payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const results: Array<{ name: string; id?: string; slug?: string; status: "created" | "failed"; reason?: string }> = [];

  for (const item of parsed.data.products) {
    const slug = item.slug ? slugify(item.slug) : slugify(item.name);

    const category = await CategoryModel.findOne({ _id: toObjectId(item.categoryId), tenantId }).lean();
    if (!category) {
      results.push({ name: item.name, status: "failed", reason: "Category not found" });
      continue;
    }

    const exists = await ProductModel.findOne({ tenantId, slug }).lean();
    if (exists) {
      results.push({ name: item.name, slug, status: "failed", reason: "Slug already exists" });
      continue;
    }

    const images = resolveProductImages(item);
    const primaryImage = images[0];
    const created = await ProductModel.create({
      tenantId,
      categoryId: category._id,
      slug,
      name: item.name,
      description: item.description,
      imageUrl: primaryImage.url,
      imagePublicId: primaryImage.publicId,
      imageFit: primaryImage.fit,
      images,
      active: item.active ?? true,
      variants: item.variants.map((variant) => ({
        _id: variant.id ? toObjectId(variant.id) : undefined,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        stock: variant.stock,
        priceNgn: variant.priceNgn
      }))
    });

    results.push({ name: created.name, id: created._id.toString(), slug: created.slug, status: "created" });
  }

  res.status(201).json({
    created: results.filter((entry) => entry.status === "created").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    results
  });
});

adminRouter.post("/products/bulk/csv", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = productBulkCsvSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid CSV payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const categories = await CategoryModel.find({ tenantId }).lean();
  if (categories.length === 0) {
    res.status(409).json({ message: "No categories found. Create a category first." });
    return;
  }

  const rows = parsed.data.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rows.length < 2) {
    res.status(400).json({ message: "CSV must include a header and at least one row." });
    return;
  }

  const header = parseCsvLine(rows[0]).map((value) => value.toLowerCase());
  const requiredColumns = ["name", "description", "imageurl", "size", "color", "stock", "pricengn"];
  for (const column of requiredColumns) {
    if (!header.includes(column)) {
      res.status(400).json({ message: `Missing required CSV column: ${column}` });
      return;
    }
  }

  type DraftProduct = {
    categoryId: string;
    slug: string;
    name: string;
    description: string;
    imageUrl: string;
    imagePublicId?: string;
    imageFit: "contain" | "cover";
    active: boolean;
    variants: Array<{ sku: string; size: string; color: string; stock: number; priceNgn: number }>;
  };

  const drafts = new Map<string, DraftProduct>();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = parseCsvLine(rows[rowIndex]);
    const row = new Map<string, string>();
    header.forEach((key, index) => {
      row.set(key, cells[index] ?? "");
    });

    const name = (row.get("name") ?? "").trim();
    if (!name) {
      res.status(400).json({ message: `Row ${rowIndex + 1}: name is required.` });
      return;
    }

    const slug = slugify((row.get("slug") ?? "").trim() || name);
    const categoryIdValue = (row.get("categoryid") ?? "").trim();
    const categoryNameValue = (row.get("categoryname") ?? "").trim().toLowerCase();
    const category =
      (categoryIdValue ? categories.find((entry) => entry._id.toString() === categoryIdValue) : undefined) ??
      (categoryNameValue ? categories.find((entry) => entry.name.toLowerCase() === categoryNameValue) : undefined) ??
      categories[0];

    const draft = drafts.get(slug) ?? {
      categoryId: category._id.toString(),
      slug,
      name,
      description: (row.get("description") ?? "").trim(),
      imageUrl: (row.get("imageurl") ?? "").trim(),
      imagePublicId: (row.get("imagepublicid") ?? "").trim() || undefined,
      imageFit: (row.get("imagefit") ?? "contain").trim().toLowerCase() === "cover" ? "cover" : "contain",
      active: (row.get("active") ?? "true").trim().toLowerCase() !== "false",
      variants: []
    };

    const size = (row.get("size") ?? "").trim();
    const color = (row.get("color") ?? "").trim();
    if (!size || !color) {
      res.status(400).json({ message: `Row ${rowIndex + 1}: size and color are required.` });
      return;
    }

    const stock = Number((row.get("stock") ?? "0").trim());
    const priceNgn = Number((row.get("pricengn") ?? "0").trim());
    const variantIndex = draft.variants.length;
    draft.variants.push({
      sku: buildSku(draft.name, color, size, variantIndex),
      size,
      color,
      stock: Number.isFinite(stock) ? Math.max(0, Math.trunc(stock)) : 0,
      priceNgn: Number.isFinite(priceNgn) ? Math.max(0, Math.trunc(priceNgn)) : 0
    });

    drafts.set(slug, draft);
  }

  const results: Array<{ name: string; id?: string; slug?: string; status: "created" | "failed"; reason?: string }> = [];
  for (const draft of drafts.values()) {
    const exists = await ProductModel.findOne({ tenantId, slug: draft.slug }).lean();
    if (exists) {
      results.push({ name: draft.name, slug: draft.slug, status: "failed", reason: "Slug already exists" });
      continue;
    }

    const images = resolveProductImages({
      imageUrl: draft.imageUrl,
      imagePublicId: draft.imagePublicId,
      imageFit: draft.imageFit
    });
    const primaryImage = images[0];
    const created = await ProductModel.create({
      tenantId,
      categoryId: toObjectId(draft.categoryId),
      slug: draft.slug,
      name: draft.name,
      description: draft.description,
      imageUrl: primaryImage.url,
      imagePublicId: primaryImage.publicId,
      imageFit: primaryImage.fit,
      images,
      active: draft.active,
      variants: draft.variants
    });
    results.push({ name: created.name, id: created._id.toString(), slug: created.slug, status: "created" });
  }

  res.status(201).json({
    created: results.filter((entry) => entry.status === "created").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    results
  });
});

adminRouter.get("/inventory", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const products = await ProductModel.find({ tenantId }).lean();
  const rows = products.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product._id.toString(),
      productName: product.name,
      variantId: variant._id.toString(),
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      priceNgn: variant.priceNgn
    }))
  );

  res.json({ rows, total: rows.length });
});

adminRouter.get("/inventory/ledger", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const variantId = typeof req.query.variantId === "string" ? req.query.variantId : undefined;

  const entries = await InventoryLedgerModel.find({
    tenantId,
    ...(productId ? { productId: toObjectId(productId) } : {}),
    ...(variantId ? { variantId: toObjectId(variantId) } : {})
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  res.json({
    rows: entries.map((entry) => ({
      id: entry._id.toString(),
      productId: entry.productId.toString(),
      variantId: entry.variantId.toString(),
      operation: entry.operation,
      delta: entry.delta,
      previousStock: entry.previousStock,
      nextStock: entry.nextStock,
      note: entry.note,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      createdAt: entry.createdAt
    }))
  });
});

adminRouter.post("/inventory/adjustments", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = inventoryAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid inventory adjustment payload", issues: parsed.error.issues });
    return;
  }

  const { productId, variantId, operation, quantity, targetStock, note } = parsed.data;
  if ((operation === "add" || operation === "remove") && !quantity) {
    res.status(400).json({ message: "Quantity is required for add/remove operations" });
    return;
  }
  if (operation === "adjust" && targetStock === undefined) {
    res.status(400).json({ message: "targetStock is required for adjust operation" });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const product = await ProductModel.findOne({ _id: toObjectId(productId), tenantId });
  if (!product) {
    res.status(404).json({ message: "Product not found" });
    return;
  }

  const variant = product.variants.id(variantId);
  if (!variant) {
    res.status(404).json({ message: "Variant not found" });
    return;
  }

  const previousStock = variant.stock;
  let nextStock = previousStock;

  if (operation === "add") {
    nextStock = previousStock + (quantity ?? 0);
  } else if (operation === "remove") {
    nextStock = previousStock - (quantity ?? 0);
  } else {
    nextStock = targetStock ?? previousStock;
  }

  if (nextStock < 0) {
    res.status(409).json({ message: "Stock cannot be negative" });
    return;
  }

  variant.stock = nextStock;
  await product.save();

  await notifyWishlistSubscribers({
    tenantId: product.tenantId,
    productId: product._id,
    productName: product.name,
    previousStock,
    currentStock: nextStock
  });

  const ledger = await InventoryLedgerModel.create({
    tenantId,
    productId: product._id,
    variantId: variant._id,
    operation,
    delta: nextStock - previousStock,
    previousStock,
    nextStock,
    note: note ?? null,
    actorId: req.claims?.userId ?? "unknown",
    actorRole: req.claims?.role ?? "admin"
  });

  res.status(201).json({
    id: ledger._id.toString(),
    productId: product._id.toString(),
    variantId: variant._id.toString(),
    operation: ledger.operation,
    delta: ledger.delta,
    previousStock: ledger.previousStock,
    nextStock: ledger.nextStock,
    note: ledger.note,
    createdAt: ledger.createdAt
  });
});

adminRouter.get("/orders", requirePermission("orders:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const orders = await OrderModel.find({
    tenantId,
    ...(status ? { status } : {})
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const userIds = [...new Set(orders.map((order) => order.userId.toString()))].map((id) => toObjectId(id));
  const users = await UserModel.find({ _id: { $in: userIds } }).select({ email: 1, firstName: 1, lastName: 1 }).lean();
  const userMap = new Map(users.map((user) => [user._id.toString(), user]));

  res.json({
    tenantId: tenantId.toString(),
    rows: orders.map((order) => ({
      id: order._id.toString(),
      orderRef: order.orderRef,
      status: order.status,
      totalNgn: order.totalNgn,
      trackingNumber: order.trackingNumber,
      createdAt: order.createdAt,
      customer: userMap.get(order.userId.toString())
        ? {
            id: order.userId.toString(),
            email: userMap.get(order.userId.toString())?.email,
            name: `${userMap.get(order.userId.toString())?.firstName ?? ""} ${userMap.get(order.userId.toString())?.lastName ?? ""}`.trim()
          }
        : null
    })),
    total: orders.length
  });
});

adminRouter.get("/users", requirePermission("users:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const users = await UserModel.find({ tenantId })
    .select({ email: 1, firstName: 1, lastName: 1, phone: 1, role: 1, accessLevel: 1, permissions: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .lean();

  res.json(
    users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      name: `${user.firstName} ${user.lastName}`.trim(),
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      accessLevel: user.role === "customer" ? null : user.accessLevel ?? (user.role === "staff" ? "staff" : "manager"),
      permissions: user.permissions
    }))
  );
});

adminRouter.get("/customers", requirePermission("users:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const segment = typeof req.query.segment === "string" ? req.query.segment.trim().toLowerCase() : "";
  const minOrders = typeof req.query.minOrders === "string" ? Number(req.query.minOrders) : 0;

  const customers = await UserModel.find({ tenantId, role: "customer" })
    .select({ email: 1, firstName: 1, lastName: 1, phone: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .lean();

  const customerIds = customers.map((customer) => customer._id);
  const orders = await OrderModel.find({ tenantId, userId: { $in: customerIds } })
    .select({ userId: 1, totalNgn: 1, status: 1, createdAt: 1 })
    .lean();

  const behaviorMap = new Map<string, { orderCount: number; totalSpendNgn: number; lastOrderAt: Date | null; cancelledCount: number }>();
  for (const order of orders) {
    const key = order.userId.toString();
    const current = behaviorMap.get(key) ?? { orderCount: 0, totalSpendNgn: 0, lastOrderAt: null, cancelledCount: 0 };
    current.orderCount += 1;
    current.totalSpendNgn += order.totalNgn;
    if (!current.lastOrderAt || order.createdAt > current.lastOrderAt) {
      current.lastOrderAt = order.createdAt;
    }
    if (order.status === "cancelled") {
      current.cancelledCount += 1;
    }
    behaviorMap.set(key, current);
  }

  const rows = customers.map((customer) => {
      const behavior = behaviorMap.get(customer._id.toString()) ?? {
        orderCount: 0,
        totalSpendNgn: 0,
        lastOrderAt: null,
        cancelledCount: 0
      };
      const averageOrderValueNgn = behavior.orderCount > 0 ? Math.round(behavior.totalSpendNgn / behavior.orderCount) : 0;
      const segment =
        behavior.totalSpendNgn >= 200000 ? "champions" : behavior.orderCount >= 3 ? "loyal" : behavior.orderCount > 0 ? "active" : "new";

      return {
        id: customer._id.toString(),
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        phone: customer.phone,
        behavior: {
          orderCount: behavior.orderCount,
          totalSpendNgn: behavior.totalSpendNgn,
          averageOrderValueNgn,
          cancelledCount: behavior.cancelledCount,
          lastOrderAt: behavior.lastOrderAt,
          segment
        }
      };
    });

  const filtered = rows.filter((row) => {
    const matchesSearch =
      !search ||
      row.email.toLowerCase().includes(search) ||
      row.name.toLowerCase().includes(search) ||
      row.phone.toLowerCase().includes(search);
    const matchesSegment = !segment || row.behavior.segment === segment;
    const matchesMinOrders = row.behavior.orderCount >= (Number.isFinite(minOrders) ? minOrders : 0);
    return matchesSearch && matchesSegment && matchesMinOrders;
  });

  res.json(filtered);
});

adminRouter.patch("/users/:id/profile", requirePermission("users:manage"), async (req: AuthRequest, res) => {
  const parsed = adminUserProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid user profile payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const userId = toObjectId(String(req.params.id));
  const { firstName, lastName, phone } = parsed.data;

  const duplicatePhone = await UserModel.findOne({
    tenantId,
    phone,
    _id: { $ne: userId }
  }).lean();

  if (duplicatePhone) {
    res.status(409).json({ message: "Phone is already in use" });
    return;
  }

  const user = await UserModel.findOne({ _id: userId, tenantId });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  user.firstName = firstName;
  user.lastName = lastName;
  user.phone = phone;
  await user.save();

  res.json({
    id: user._id.toString(),
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    name: `${user.firstName} ${user.lastName}`.trim(),
    role: user.role,
    accessLevel: user.role === "customer" ? null : user.accessLevel ?? (user.role === "staff" ? "staff" : "manager"),
    permissions: user.permissions
  });
});

adminRouter.get("/orders/:id", requirePermission("orders:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const order = await OrderModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId }).lean();
  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  const customer = await UserModel.findById(order.userId).select({ email: 1, firstName: 1, lastName: 1 }).lean();

  res.json({
    id: order._id.toString(),
    orderRef: order.orderRef,
    status: order.status,
    trackingNumber: order.trackingNumber,
    subtotalNgn: order.subtotalNgn,
    shippingNgn: order.shippingNgn,
    totalNgn: order.totalNgn,
    shippingAddress: order.shippingAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.lines,
    timeline: order.timeline ?? [],
    customer: customer
      ? {
          id: order.userId.toString(),
          email: customer.email,
          name: `${customer.firstName} ${customer.lastName}`.trim()
        }
      : null
  });
});

adminRouter.get("/orders/:id/tracking-events", requirePermission("orders:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const orderId = toObjectId(String(req.params.id));
  const events = await TrackingEventModel.find({ tenantId, orderId }).sort({ eventAt: -1 }).lean();
  res.json(
    events.map((event) => ({
      id: event._id.toString(),
      provider: event.provider,
      externalTrackingId: event.externalTrackingId,
      status: event.status,
      location: event.location,
      message: event.message,
      eventAt: event.eventAt,
      raw: event.raw
    }))
  );
});

adminRouter.post("/orders/:id/tracking-events", requirePermission("orders:write"), async (req: AuthRequest, res) => {
  const parsed = orderTrackingEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid tracking event payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const orderId = toObjectId(String(req.params.id));
  const order = await OrderModel.findOne({ _id: orderId, tenantId });
  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  const event = await TrackingEventModel.create({
    tenantId,
    orderId,
    provider: parsed.data.provider,
    externalTrackingId: parsed.data.externalTrackingId,
    status: parsed.data.status,
    location: parsed.data.location ?? null,
    message: parsed.data.message ?? null,
    eventAt: parsed.data.eventAt ? new Date(parsed.data.eventAt) : new Date(),
    raw: req.body.raw ?? null
  });

  if ((parsed.data.status === "delivered" || parsed.data.status === "out_for_delivery" || parsed.data.status === "in_transit") && parsed.data.externalTrackingId) {
    order.trackingNumber = parsed.data.externalTrackingId;
    if (parsed.data.status === "delivered") {
      order.status = "delivered";
    } else if (order.status === "processing" || order.status === "paid") {
      order.status = "shipped";
    }
    order.timeline.push({
      status: order.status,
      note: parsed.data.message ?? `Carrier update: ${parsed.data.status}`,
      trackingNumber: order.trackingNumber,
      actor: req.claims?.role ?? "admin",
      at: new Date()
    });
    await order.save();
  }

  res.status(201).json({
    id: event._id.toString(),
    provider: event.provider,
    externalTrackingId: event.externalTrackingId,
    status: event.status,
    location: event.location,
    message: event.message,
    eventAt: event.eventAt
  });
});

adminRouter.patch("/orders/:id/status", requirePermission("orders:write"), async (req: AuthRequest, res) => {
  const parsed = adminOrderStatusUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid status update payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const order = await OrderModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId });

  if (!order) {
    res.status(404).json({ message: "Order not found" });
    return;
  }

  const { status, trackingNumber, note } = parsed.data;

  if (!canTransition(order.status, status)) {
    res.status(409).json({ message: `Invalid transition from ${order.status} to ${status}` });
    return;
  }

  if (status === "shipped" && !trackingNumber && !order.trackingNumber) {
    res.status(400).json({ message: "Tracking number is required when shipping an order" });
    return;
  }

  order.status = status;
  if (trackingNumber) {
    order.trackingNumber = trackingNumber;
  }

  order.timeline.push({
    status,
    note: note ?? `Order marked as ${status}`,
    trackingNumber: order.trackingNumber,
    actor: req.claims?.role ?? "admin",
    at: new Date()
  });

  await order.save();

  if (status === "paid" || status === "shipped" || status === "delivered") {
    const customer = await UserModel.findById(order.userId).select({ email: 1, firstName: 1, lastName: 1 }).lean();
    if (customer?.email) {
      await enqueueOrderStatusNotification({
        tenantId: order.tenantId.toString(),
        userId: order.userId.toString(),
        email: customer.email,
        customerName: `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim(),
        orderId: order._id.toString(),
        orderRef: order.orderRef,
        status,
        trackingNumber: order.trackingNumber,
        note: note ?? `Order marked as ${status}`
      });
    }
  }

  res.json({
    id: order._id.toString(),
    status: order.status,
    trackingNumber: order.trackingNumber,
    timeline: order.timeline
  });
  await logAdminAction({
    tenantId,
    req,
    action: "order.status.update",
    entityType: "order",
    entityId: order._id.toString(),
    message: `Changed order ${order.orderRef} status to ${order.status}.`,
    metadata: { status: order.status, trackingNumber: order.trackingNumber }
  });
});

adminRouter.patch("/users/:id/access-level", requirePermission("users:manage"), async (req: AuthRequest, res) => {
  const parsed = adminUserAccessLevelUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid access level payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const user = await UserModel.findOne({ _id: toObjectId(String(req.params.id)), tenantId, role: { $in: ["admin", "staff"] } });
  if (!user) {
    res.status(404).json({ message: "Admin user not found" });
    return;
  }

  const accessLevel = adminAccessLevelSchema.parse(parsed.data.accessLevel);
  user.accessLevel = accessLevel;
  user.role = resolveRole(accessLevel);
  user.permissions = resolvePermissions(accessLevel);

  await user.save();

  res.json({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    accessLevel: user.accessLevel,
    permissions: user.permissions
  });
});

adminRouter.post("/orders/:id/refunds", (req, res) => {
  res.status(201).json({ id: `ref_${Date.now()}`, orderId: req.params.id, amountNgn: req.body.amountNgn ?? 0 });
});

adminRouter.get("/store/branches", requirePermission("users:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const branches = await StoreBranchModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
  res.json(
    branches.map((branch) => ({
      id: branch._id.toString(),
      name: branch.name,
      code: branch.code,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      phone: branch.phone,
      active: branch.active
    }))
  );
});

adminRouter.post("/store/branches", requirePermission("users:manage"), async (req: AuthRequest, res) => {
  const parsed = storeBranchCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid branch payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const code = parsed.data.code.trim().toUpperCase();
  const exists = await StoreBranchModel.findOne({ tenantId, code }).lean();
  if (exists) {
    res.status(409).json({ message: "Branch code already exists" });
    return;
  }

  const branch = await StoreBranchModel.create({
    tenantId,
    ...parsed.data,
    code
  });

  res.status(201).json({
    id: branch._id.toString(),
    name: branch.name,
    code: branch.code,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    phone: branch.phone,
    active: branch.active
  });
});

adminRouter.patch("/store/branches/:id", requirePermission("users:manage"), async (req: AuthRequest, res) => {
  const parsed = storeBranchUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid branch update payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const branch = await StoreBranchModel.findOne({ tenantId, _id: toObjectId(String(req.params.id)) });
  if (!branch) {
    res.status(404).json({ message: "Branch not found" });
    return;
  }

  if (parsed.data.code && parsed.data.code.toUpperCase() !== branch.code) {
    const duplicate = await StoreBranchModel.findOne({ tenantId, code: parsed.data.code.toUpperCase(), _id: { $ne: branch._id } }).lean();
    if (duplicate) {
      res.status(409).json({ message: "Branch code already exists" });
      return;
    }
    branch.code = parsed.data.code.toUpperCase();
  }

  if (parsed.data.name !== undefined) branch.name = parsed.data.name;
  if (parsed.data.address !== undefined) branch.address = parsed.data.address;
  if (parsed.data.city !== undefined) branch.city = parsed.data.city;
  if (parsed.data.state !== undefined) branch.state = parsed.data.state;
  if (parsed.data.phone !== undefined) branch.phone = parsed.data.phone;
  if (parsed.data.active !== undefined) branch.active = parsed.data.active;
  await branch.save();

  res.json({
    id: branch._id.toString(),
    name: branch.name,
    code: branch.code,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    phone: branch.phone,
    active: branch.active
  });
});

adminRouter.get("/reports/summary", requirePermission("reports:view"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const orders = await OrderModel.find({ tenantId }).lean();
  const paidOrders = orders.filter((order) => order.status !== "cancelled");
  const revenueNgn = paidOrders.reduce((sum, order) => sum + order.totalNgn, 0);
  const averageOrderValueNgn = paidOrders.length > 0 ? Math.round(revenueNgn / paidOrders.length) : 0;
  const cancelledRatePercent = orders.length > 0 ? Number(((orders.filter((order) => order.status === "cancelled").length / orders.length) * 100).toFixed(2)) : 0;

  res.json({
    cards: [
      { key: "revenue", label: "Revenue", value: revenueNgn, unit: "NGN" },
      { key: "orders", label: "Orders", value: orders.length, unit: "count" },
      { key: "aov", label: "Average Order Value", value: averageOrderValueNgn, unit: "NGN" },
      { key: "cancelled_rate", label: "Cancelled Rate", value: cancelledRatePercent, unit: "percent" }
    ]
  });
});

adminRouter.get("/audit-logs", requirePermission("users:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const logs = await AdminAuditLogModel.find({ tenantId }).sort({ createdAt: -1 }).limit(200).lean();
  res.json(
    logs.map((log) => ({
      id: log._id.toString(),
      actorUserId: log.actorUserId.toString(),
      actorRole: log.actorRole,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId ?? null,
      message: log.message,
      metadata: log.metadata ?? {},
      createdAt: log.createdAt
    }))
  );
});

adminRouter.get("/content", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const settings =
    (await ContentSettingsModel.findOne({ tenantId }).lean()) ??
    (await ContentSettingsModel.create({ tenantId }));
  res.json({
    id: settings._id.toString(),
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    heroCtaLabel: settings.heroCtaLabel,
    heroCtaPath: settings.heroCtaPath,
    promoStripText: settings.promoStripText,
    featuredCategorySlugs: settings.featuredCategorySlugs
  });
});

adminRouter.patch("/content", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = contentSettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid content payload", issues: parsed.error.issues });
    return;
  }
  const tenantId = await resolveTenantId(req.tenantId!);
  const settings =
    (await ContentSettingsModel.findOne({ tenantId })) ??
    (await ContentSettingsModel.create({ tenantId }));

  if (parsed.data.heroTitle !== undefined) settings.heroTitle = parsed.data.heroTitle;
  if (parsed.data.heroSubtitle !== undefined) settings.heroSubtitle = parsed.data.heroSubtitle;
  if (parsed.data.heroCtaLabel !== undefined) settings.heroCtaLabel = parsed.data.heroCtaLabel;
  if (parsed.data.heroCtaPath !== undefined) settings.heroCtaPath = parsed.data.heroCtaPath;
  if (parsed.data.promoStripText !== undefined) settings.promoStripText = parsed.data.promoStripText;
  if (parsed.data.featuredCategorySlugs !== undefined) settings.featuredCategorySlugs = parsed.data.featuredCategorySlugs;
  await settings.save();
  await logAdminAction({
    tenantId,
    req,
    action: "content.update",
    entityType: "content_settings",
    entityId: settings._id.toString(),
    message: "Updated storefront content settings."
  });

  res.json({
    id: settings._id.toString(),
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    heroCtaLabel: settings.heroCtaLabel,
    heroCtaPath: settings.heroCtaPath,
    promoStripText: settings.promoStripText,
    featuredCategorySlugs: settings.featuredCategorySlugs
  });
});

adminRouter.get("/notifications", requirePermission("users:read"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const [products, pendingOrders, failedPayments, recentCampaigns] = await Promise.all([
    ProductModel.find({ tenantId }).select({ name: 1, variants: 1 }).limit(250).lean(),
    OrderModel.countDocuments({ tenantId, status: { $in: ["pending", "processing", "paid"] } }),
    OrderModel.countDocuments({ tenantId, status: "cancelled" }),
    CampaignModel.find({ tenantId }).sort({ createdAt: -1 }).limit(6).lean()
  ]);

  const lowStockItems = products.flatMap((product) =>
    product.variants
      .filter((variant) => variant.stock <= 3)
      .map((variant) => ({
        id: `${product._id.toString()}-${variant._id.toString()}`,
        title: "Low inventory",
        message: `${product.name} (${variant.size}/${variant.color}) has low stock: ${variant.stock}`,
        severity: variant.stock === 0 ? "error" : "warning",
        source: "inventory"
      }))
  );

  const operational = [
    {
      id: "ops-pending-orders",
      title: "Open orders",
      message: `${pendingOrders} orders are currently awaiting fulfillment or delivery updates.`,
      severity: pendingOrders > 20 ? "warning" : "info",
      source: "orders"
    },
    {
      id: "ops-cancelled-orders",
      title: "Cancelled orders",
      message: `${failedPayments} orders are marked cancelled and may require review.`,
      severity: failedPayments > 10 ? "warning" : "info",
      source: "orders"
    },
    ...recentCampaigns.map((campaign) => ({
      id: `campaign-${campaign._id.toString()}`,
      title: "Campaign update",
      message: `${campaign.name} is ${campaign.status}. Sent: ${campaign.stats?.sent ?? 0}, Revenue: NGN ${(
        campaign.stats?.revenueNgn ?? 0
      ).toLocaleString()}.`,
      severity: campaign.status === "draft" ? "info" : "success",
      source: "campaigns"
    }))
  ];

  res.json({
    rows: [...lowStockItems.slice(0, 20), ...operational].map((row) => ({
      ...row,
      createdAt: new Date().toISOString()
    }))
  });
});

adminRouter.get("/reports/:key", (req, res) => {
  res.json({ report: req.params.key, generatedAt: new Date().toISOString(), rows: [] });
});

adminRouter.post("/reports/:key/export", (req, res) => {
  const parsed = reportExportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid export payload", issues: parsed.error.issues });
    return;
  }

  res.status(202).json({ jobId: `job_${Date.now()}`, report: req.params.key, ...parsed.data });
});

adminRouter.get("/campaigns", requirePermission("reports:view"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const campaigns = await CampaignModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
  res.json(
    campaigns.map((campaign) => ({
      id: campaign._id.toString(),
      name: campaign.name,
      segment: campaign.segment,
      subject: campaign.subject,
      status: campaign.status,
      sentAt: campaign.sentAt,
      stats: campaign.stats
    }))
  );
});

adminRouter.post("/campaigns", async (req: AuthRequest, res) => {
  const parsed = campaignCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid campaign payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const campaign = await CampaignModel.create({
    tenantId,
    ...parsed.data,
    status: "draft"
  });

  res.status(201).json({ id: campaign._id.toString(), ...parsed.data, status: campaign.status });
});

adminRouter.post("/campaigns/:id/send", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const campaign = await CampaignModel.findOne({ tenantId, _id: toObjectId(String(req.params.id)) });
  if (!campaign) {
    res.status(404).json({ message: "Campaign not found" });
    return;
  }

  campaign.status = "sent";
  campaign.sentAt = new Date();
  const stats = campaign.stats ?? { sent: 0, opened: 0, clicked: 0, purchased: 0, revenueNgn: 0 };
  stats.sent = Math.max(stats.sent, 100);
  stats.opened = Math.max(stats.opened, 44);
  stats.clicked = Math.max(stats.clicked, 18);
  stats.purchased = Math.max(stats.purchased, 9);
  stats.revenueNgn = Math.max(stats.revenueNgn, 450000);
  campaign.stats = stats;
  await campaign.save();

  res.status(202).json({ campaignId: campaign._id.toString(), scheduledFor: req.body.scheduledFor ?? "now", status: campaign.status });
});

adminRouter.get("/campaigns/:id/performance", async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const campaign = await CampaignModel.findOne({ tenantId, _id: toObjectId(String(req.params.id)) }).lean();
  if (!campaign) {
    res.status(404).json({ message: "Campaign not found" });
    return;
  }
  const stats = campaign.stats ?? { sent: 0, opened: 0, clicked: 0, purchased: 0, revenueNgn: 0 };
  const roiPercent = stats.sent > 0 ? Number((((stats.revenueNgn - stats.sent * 1000) / (stats.sent * 1000)) * 100).toFixed(2)) : 0;
  res.json({
    campaignId: campaign._id.toString(),
    sent: stats.sent,
    opened: stats.opened,
    clicked: stats.clicked,
    purchased: stats.purchased,
    revenueNgn: stats.revenueNgn,
    roiPercent
  });
});

adminRouter.get("/flash-deals", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const deals = await FlashDealModel.find({ tenantId }).sort({ startAt: -1 }).lean();
  res.json(
    deals.map((deal) => ({
      id: deal._id.toString(),
      title: deal.title,
      startAt: deal.startAt,
      endAt: deal.endAt,
      discountPercent: deal.discountPercent,
      productIds: deal.productIds.map((id) => id.toString()),
      active: deal.active
    }))
  );
});

adminRouter.post("/flash-deals", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = flashDealCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid flash deal payload", issues: parsed.error.issues });
    return;
  }
  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    res.status(400).json({ message: "Flash deal start/end dates are invalid" });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const productObjectIds = parsed.data.productIds.map((id) => toObjectId(id));
  const validProductCount = await ProductModel.countDocuments({ tenantId, _id: { $in: productObjectIds } });
  if (validProductCount !== productObjectIds.length) {
    res.status(400).json({ message: "One or more products do not exist for this store" });
    return;
  }

  const deal = await FlashDealModel.create({
    tenantId,
    title: parsed.data.title,
    startAt,
    endAt,
    discountPercent: parsed.data.discountPercent,
    productIds: productObjectIds,
    active: parsed.data.active ?? true
  });

  res.status(201).json({
    id: deal._id.toString(),
    title: deal.title,
    startAt: deal.startAt,
    endAt: deal.endAt,
    discountPercent: deal.discountPercent,
    productIds: deal.productIds.map((id) => id.toString()),
    active: deal.active
  });
  await logAdminAction({
    tenantId,
    req,
    action: "flash_deal.create",
    entityType: "flash_deal",
    entityId: deal._id.toString(),
    message: `Created flash deal ${deal.title}.`,
    metadata: { discountPercent: deal.discountPercent, productCount: deal.productIds.length }
  });
});

adminRouter.patch("/flash-deals/:id", requirePermission("inventory:manage"), async (req: AuthRequest, res) => {
  const parsed = flashDealCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid flash deal payload", issues: parsed.error.issues });
    return;
  }
  const tenantId = await resolveTenantId(req.tenantId!);
  const deal = await FlashDealModel.findOne({ tenantId, _id: toObjectId(String(req.params.id)) });
  if (!deal) {
    res.status(404).json({ message: "Flash deal not found" });
    return;
  }
  if (parsed.data.title !== undefined) deal.title = parsed.data.title;
  if (parsed.data.startAt !== undefined) deal.startAt = new Date(parsed.data.startAt);
  if (parsed.data.endAt !== undefined) deal.endAt = new Date(parsed.data.endAt);
  if (parsed.data.discountPercent !== undefined) deal.discountPercent = parsed.data.discountPercent;
  if (parsed.data.active !== undefined) deal.active = parsed.data.active;
  if (parsed.data.productIds !== undefined) {
    const productObjectIds = parsed.data.productIds.map((id) => toObjectId(id));
    const validProductCount = await ProductModel.countDocuments({ tenantId, _id: { $in: productObjectIds } });
    if (validProductCount !== productObjectIds.length) {
      res.status(400).json({ message: "One or more products do not exist for this store" });
      return;
    }
    deal.productIds = productObjectIds;
  }
  if (deal.endAt <= deal.startAt) {
    res.status(400).json({ message: "Flash deal end date must be after start date" });
    return;
  }
  await deal.save();
  res.json({
    id: deal._id.toString(),
    title: deal.title,
    startAt: deal.startAt,
    endAt: deal.endAt,
    discountPercent: deal.discountPercent,
    productIds: deal.productIds.map((id) => id.toString()),
    active: deal.active
  });
  await logAdminAction({
    tenantId,
    req,
    action: "flash_deal.update",
    entityType: "flash_deal",
    entityId: deal._id.toString(),
    message: `Updated flash deal ${deal.title}.`,
    metadata: { active: deal.active, discountPercent: deal.discountPercent }
  });
});

adminRouter.get("/discounts", requirePermission("reports:view"), async (req: AuthRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const discounts = await DiscountModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
  res.json(
    discounts.map((discount) => ({
      id: discount._id.toString(),
      code: discount.code,
      type: discount.type,
      value: discount.value,
      minOrderNgn: discount.minOrderNgn,
      maxUses: discount.maxUses,
      usedCount: discount.usedCount,
      active: discount.active
    }))
  );
});

adminRouter.post("/discounts", requirePermission("orders:write"), async (req: AuthRequest, res) => {
  const parsed = discountCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid discount payload", issues: parsed.error.issues });
    return;
  }
  const tenantId = await resolveTenantId(req.tenantId!);
  const code = parsed.data.code.trim().toUpperCase();
  const exists = await DiscountModel.findOne({ tenantId, code }).lean();
  if (exists) {
    res.status(409).json({ message: "Discount code already exists" });
    return;
  }
  const discount = await DiscountModel.create({
    tenantId,
    ...parsed.data,
    code,
    minOrderNgn: parsed.data.minOrderNgn ?? 0,
    maxUses: parsed.data.maxUses ?? null,
    active: parsed.data.active ?? true
  });

  res.status(201).json({
    id: discount._id.toString(),
    code: discount.code,
    type: discount.type,
    value: discount.value,
    minOrderNgn: discount.minOrderNgn,
    maxUses: discount.maxUses,
    usedCount: discount.usedCount,
    active: discount.active
  });
});

adminRouter.patch("/discounts/:id", requirePermission("orders:write"), async (req: AuthRequest, res) => {
  const parsed = discountCreateSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid discount payload", issues: parsed.error.issues });
    return;
  }
  const tenantId = await resolveTenantId(req.tenantId!);
  const discount = await DiscountModel.findOne({ tenantId, _id: toObjectId(String(req.params.id)) });
  if (!discount) {
    res.status(404).json({ message: "Discount not found" });
    return;
  }

  if (parsed.data.code) {
    const normalizedCode = parsed.data.code.trim().toUpperCase();
    const exists = await DiscountModel.findOne({ tenantId, code: normalizedCode, _id: { $ne: discount._id } }).lean();
    if (exists) {
      res.status(409).json({ message: "Discount code already exists" });
      return;
    }
    discount.code = normalizedCode;
  }
  if (parsed.data.type !== undefined) discount.type = parsed.data.type;
  if (parsed.data.value !== undefined) discount.value = parsed.data.value;
  if (parsed.data.minOrderNgn !== undefined) discount.minOrderNgn = parsed.data.minOrderNgn;
  if (parsed.data.maxUses !== undefined) discount.maxUses = parsed.data.maxUses;
  if (parsed.data.active !== undefined) discount.active = parsed.data.active;
  await discount.save();

  res.json({
    id: discount._id.toString(),
    code: discount.code,
    type: discount.type,
    value: discount.value,
    minOrderNgn: discount.minOrderNgn,
    maxUses: discount.maxUses,
    usedCount: discount.usedCount,
    active: discount.active
  });
});
