import { Router } from "express";
import { cartItemSchema, updateCartItemSchema } from "@sws/shared-types";
import { CartModel } from "../models/cart.js";
import { ProductModel } from "../models/catalog.js";
import type { AuthRequest } from "../middleware/auth.js";
import { resolveTenantId } from "../services/tenant.js";
import { toObjectId } from "../utils/ids.js";
import { calculateCartTotals } from "../utils/cart.js";

export const cartRouter = Router();

type CartIdentity = { userId?: string; sessionId?: string };

function resolveCartIdentity(req: AuthRequest): CartIdentity {
  if (req.claims?.role === "customer") {
    return { userId: req.claims.userId };
  }
  const sessionId = req.header("x-session-id");
  if (!sessionId) {
    throw new Error("Missing authentication or x-session-id");
  }
  return { sessionId };
}

async function findOrCreateCart(req: AuthRequest) {
  const tenantId = await resolveTenantId(req.tenantId!);
  const identity = resolveCartIdentity(req);

  let cart = await CartModel.findOne({
    tenantId,
    ...(identity.userId ? { userId: toObjectId(identity.userId) } : { sessionId: identity.sessionId })
  });

  if (!cart) {
    cart = await CartModel.create({
      tenantId,
      userId: identity.userId ? toObjectId(identity.userId) : null,
      sessionId: identity.sessionId ?? null,
      lines: []
    });
  }

  return cart;
}

function serializeCart(cart: Awaited<ReturnType<typeof findOrCreateCart>>) {
  const totals = calculateCartTotals(cart);
  return {
    id: cart._id.toString(),
    tenantId: cart.tenantId.toString(),
    lines: cart.lines.map((line) => ({
      id: line._id.toString(),
      productId: line.productId.toString(),
      variantId: line.variantId.toString(),
      name: line.name,
      quantity: line.quantity,
      unitPriceNgn: line.unitPriceNgn
    })),
    currency: "NGN",
    ...totals
  };
}

cartRouter.get("/", async (req: AuthRequest, res) => {
  try {
    const cart = await findOrCreateCart(req);
    res.json(serializeCart(cart));
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

cartRouter.post("/items", async (req: AuthRequest, res) => {
  const parsed = cartItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid cart item payload", issues: parsed.error.issues });
    return;
  }

  try {
    const tenantId = await resolveTenantId(req.tenantId!);
    const cart = await findOrCreateCart(req);

    const product = await ProductModel.findOne({ _id: toObjectId(parsed.data.productId), tenantId, active: true });
    if (!product) {
      res.status(404).json({ message: "Product not found" });
      return;
    }

    const variant = product.variants.id(parsed.data.variantId);
    if (!variant) {
      res.status(404).json({ message: "Variant not found" });
      return;
    }

    if (variant.stock < parsed.data.quantity) {
      res.status(409).json({ message: "Insufficient stock" });
      return;
    }

    const existingLine = cart.lines.find((line) => line.variantId.toString() === parsed.data.variantId);
    if (existingLine) {
      existingLine.quantity = parsed.data.quantity;
      existingLine.unitPriceNgn = variant.priceNgn;
    } else {
      cart.lines.push({
        productId: product._id,
        variantId: variant._id,
        name: `${product.name} (${variant.size}/${variant.color})`,
        quantity: parsed.data.quantity,
        unitPriceNgn: variant.priceNgn
      });
    }

    await cart.save();
    res.status(201).json(serializeCart(cart));
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

cartRouter.patch("/items/:id", async (req: AuthRequest, res) => {
  const parsed = updateCartItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid update payload", issues: parsed.error.issues });
    return;
  }

  try {
    const cart = await findOrCreateCart(req);
    const line = cart.lines.id(String(req.params.id));
    if (!line) {
      res.status(404).json({ message: "Cart line not found" });
      return;
    }

    line.quantity = parsed.data.quantity;
    await cart.save();
    res.json(serializeCart(cart));
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

cartRouter.delete("/items/:id", async (req: AuthRequest, res) => {
  try {
    const cart = await findOrCreateCart(req);
    const line = cart.lines.id(String(req.params.id));
    if (!line) {
      res.status(404).json({ message: "Cart line not found" });
      return;
    }

    line.deleteOne();
    await cart.save();
    res.status(204).send();
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});
