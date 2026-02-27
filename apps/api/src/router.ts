import { Router } from "express";
import { requireTenant } from "./middleware/tenant.js";
import { optionalAuth } from "./middleware/auth.js";
import { authRouter } from "./modules/auth.js";
import { categoriesRouter, productsRouter } from "./modules/catalog.js";
import { cartRouter } from "./modules/cart.js";
import { checkoutRouter } from "./modules/checkout.js";
import { paymentsRouter } from "./modules/payments.js";
import { ordersRouter } from "./modules/orders.js";
import { wishlistRouter } from "./modules/wishlist.js";
import { notificationsRouter } from "./modules/notifications.js";
import { addressesRouter } from "./modules/addresses.js";
import { recommendationsRouter } from "./modules/recommendations.js";
import { adminRouter } from "./modules/admin.js";
import { adminAuthRouter } from "./modules/adminAuth.js";

export const router = Router();

router.use(requireTenant);
router.use(optionalAuth);

router.use("/auth", authRouter);
router.use("/products", productsRouter);
router.use("/categories", categoriesRouter);
router.use("/cart", cartRouter);
router.use("/checkout", checkoutRouter);
router.use("/payments", paymentsRouter);
router.use("/orders", ordersRouter);
router.use("/addresses", addressesRouter);
router.use("/wishlist", wishlistRouter);
router.use("/notifications", notificationsRouter);
router.use("/recommendations", recommendationsRouter);
router.use("/admin/auth", adminAuthRouter);
router.use("/admin", adminRouter);
