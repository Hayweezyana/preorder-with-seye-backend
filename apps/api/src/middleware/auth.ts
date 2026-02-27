import type { NextFunction, Response } from "express";
import { authClaimsSchema, type AuthClaims } from "@sws/shared-types";
import { verifyAccessToken } from "../utils/tokens.js";
import type { TenantRequest } from "./tenant.js";

export type AuthRequest = TenantRequest & { claims?: AuthClaims };

function parseBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }
  return authorizationHeader.slice("Bearer ".length);
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = parseBearerToken(req.header("authorization"));
  if (!token) {
    next();
    return;
  }

  if (token === "demo-admin-token" && process.env.NODE_ENV !== "production") {
    req.claims = {
      tenantId: req.tenantId ?? "",
      userId: "demo-admin",
      role: "admin",
      permissions: ["orders:read", "orders:write", "users:read", "users:manage", "reports:view", "inventory:manage"],
      twoFactorVerified: true
    };
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.claims = authClaimsSchema.parse(payload);
  } catch {
    req.claims = undefined;
  }

  next();
}

export function requireCustomer(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.claims || req.claims.role !== "customer") {
    res.status(401).json({ message: "Customer authentication required" });
    return;
  }

  if (req.claims.tenantId !== req.tenantId) {
    res.status(403).json({ message: "Cross-tenant access denied" });
    return;
  }

  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.claims || (req.claims.role !== "admin" && req.claims.role !== "staff")) {
    res.status(401).json({ message: "Admin authentication required" });
    return;
  }

  if (req.claims.tenantId !== req.tenantId) {
    res.status(403).json({ message: "Cross-tenant access denied" });
    return;
  }

  next();
}

export function requirePermission(permission: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.claims) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }

    if (req.claims.role === "admin" && req.claims.permissions.includes("users:manage")) {
      next();
      return;
    }

    if (!req.claims.permissions.includes(permission)) {
      res.status(403).json({ message: `Missing permission: ${permission}` });
      return;
    }

    next();
  };
}
