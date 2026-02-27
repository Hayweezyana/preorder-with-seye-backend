import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthClaims } from "@sws/shared-types";

export function signAccessToken(claims: AuthClaims) {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(claims: Pick<AuthClaims, "tenantId" | "userId" | "role">) {
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, { expiresIn: "30d" });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_SECRET);
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { tenantId: string; userId: string; role: string };
}
