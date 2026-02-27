import type { NextFunction, Request, Response } from "express";
import { resolveTenantId } from "../services/tenant.js";

export type TenantRequest = Request & { tenantId?: string };

export async function requireTenant(req: TenantRequest, res: Response, next: NextFunction) {
  if (req.path === "/payments/paystack/webhook" || req.path === "/payments/paystack/callback") {
    next();
    return;
  }

  const tenantHeader = req.header("x-tenant-id");
  if (!tenantHeader) {
    res.status(400).json({ message: "Missing x-tenant-id header" });
    return;
  }

  try {
    req.tenantId = (await resolveTenantId(tenantHeader)).toString();
    next();
  } catch {
    res.status(404).json({ message: "Tenant not found" });
  }
}
