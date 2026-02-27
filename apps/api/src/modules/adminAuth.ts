import { Router } from "express";
import {
  adminAccessLevelSchema,
  adminLoginRequestSchema,
  adminOtpVerifySchema,
  adminPasswordResetConfirmSchema,
  adminPasswordResetRequestSchema,
  adminRegisterRequestSchema,
  refreshSchema
} from "@sws/shared-types";
import { z } from "zod";
import { OtpChallengeModel } from "../models/otpChallenge.js";
import { UserModel } from "../models/user.js";
import { resolveTenantId } from "../services/tenant.js";
import { compareValue, hashValue } from "../utils/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/tokens.js";
import { enqueueAdminOtpNotification } from "../services/notificationQueue.js";
import { resolvePermissions, resolveRole, type AccessLevel } from "../services/accessControl.js";
import type { TenantRequest } from "../middleware/tenant.js";

const OTP_EXPIRY_MINUTES = 10;
const adminRegisterAvailabilitySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7)
});

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createOtpChallenge(params: {
  tenantId: string;
  email: string;
  purpose: "admin_register" | "admin_login" | "admin_reset";
  metadata?: Record<string, unknown>;
}) {
  const code = generateOtp();
  const codeHash = await hashValue(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OtpChallengeModel.updateMany(
    {
      tenantId: params.tenantId,
      email: params.email,
      purpose: params.purpose,
      consumedAt: null
    },
    { $set: { consumedAt: new Date() } }
  );

  await OtpChallengeModel.create({
    tenantId: params.tenantId,
    email: params.email,
    purpose: params.purpose,
    codeHash,
    metadata: params.metadata ?? {},
    expiresAt
  });

  await enqueueAdminOtpNotification({
    email: params.email,
    firstName: typeof params.metadata?.firstName === "string" ? params.metadata.firstName : undefined,
    purpose: params.purpose,
    code,
    expiresInMinutes: OTP_EXPIRY_MINUTES
  });

  return { expiresInMinutes: OTP_EXPIRY_MINUTES };
}

async function consumeOtp(params: {
  tenantId: string;
  email: string;
  purpose: "admin_register" | "admin_login" | "admin_reset";
  otp: string;
}) {
  const challenge = await OtpChallengeModel.findOne({
    tenantId: params.tenantId,
    email: params.email,
    purpose: params.purpose,
    consumedAt: null
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw new Error("OTP challenge not found");
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    throw new Error("OTP expired");
  }

  const matches = await compareValue(params.otp, challenge.codeHash);
  if (!matches) {
    throw new Error("Invalid OTP");
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  return challenge;
}

function buildAdminTokens(user: {
  tenantId: { toString(): string };
  _id: { toString(): string };
  role: "admin" | "staff";
  permissions: string[];
  email: string;
  accessLevel?: string | null;
}) {
  const claims = {
    tenantId: user.tenantId.toString(),
    userId: user._id.toString(),
    role: user.role,
    permissions: user.permissions,
    twoFactorVerified: true
  } as const;

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken({ tenantId: claims.tenantId, userId: claims.userId, role: claims.role });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      accessLevel: user.accessLevel ?? (user.role === "staff" ? "staff" : "manager"),
      permissions: user.permissions
    }
  };
}

function normalizeAdminRole(role: "customer" | "admin" | "staff"): "admin" | "staff" {
  if (role === "admin" || role === "staff") {
    return role;
  }

  throw new Error("Invalid admin role");
}

export const adminAuthRouter = Router();

adminAuthRouter.post("/register/request", async (req: TenantRequest, res) => {
  const parsed = adminRegisterRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid registration request", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();

  const [existingByEmail, existingByPhone] = await Promise.all([
    UserModel.findOne({ tenantId, email }),
    UserModel.findOne({ tenantId, phone: parsed.data.phone })
  ]);
  if (existingByEmail) {
    res.status(409).json({ message: "Email is already in use" });
    return;
  }
  if (existingByPhone) {
    res.status(409).json({ message: "Phone is already in use" });
    return;
  }

  await createOtpChallenge({
    tenantId,
    email,
    purpose: "admin_register",
    metadata: {
      email,
      passwordHash: await hashValue(parsed.data.password),
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone,
      accessLevel: parsed.data.accessLevel
    }
  });

  res.status(202).json({ message: "OTP sent to email" });
});

adminAuthRouter.post("/register/availability", async (req: TenantRequest, res) => {
  const parsed = adminRegisterAvailabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid availability payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();
  const [existingByEmail, existingByPhone] = await Promise.all([
    UserModel.findOne({ tenantId, email }).lean(),
    UserModel.findOne({ tenantId, phone: parsed.data.phone }).lean()
  ]);

  res.json({
    emailAvailable: !existingByEmail,
    phoneAvailable: !existingByPhone
  });
});

adminAuthRouter.post("/register/verify", async (req: TenantRequest, res) => {
  const parsed = adminOtpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid OTP verification request", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();

  try {
    const challenge = await consumeOtp({
      tenantId,
      email,
      purpose: "admin_register",
      otp: parsed.data.otp
    });

    const metadata = challenge.metadata as {
      passwordHash: string;
      firstName: string;
      lastName: string;
      phone: string;
      accessLevel: AccessLevel;
    };

    const accessLevel = adminAccessLevelSchema.parse(metadata.accessLevel);
    const role = resolveRole(accessLevel);
    const permissions = resolvePermissions(accessLevel);

    const user = await UserModel.create({
      tenantId,
      email,
      passwordHash: metadata.passwordHash,
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      phone: metadata.phone,
      role,
      accessLevel,
      permissions
    });

    const tokens = buildAdminTokens({
      tenantId: user.tenantId,
      _id: user._id,
      role: normalizeAdminRole(user.role),
      permissions: user.permissions,
      email: user.email,
      accessLevel: user.accessLevel
    });

    user.refreshTokenHash = await hashValue(tokens.refreshToken);
    await user.save();

    res.status(201).json(tokens);
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

adminAuthRouter.post("/login/request", async (req: TenantRequest, res) => {
  const parsed = adminLoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid login request", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();
  const user = await UserModel.findOne({ tenantId, email, role: { $in: ["admin", "staff"] } });

  if (!user) {
    res.status(404).json({ message: "Admin account not found" });
    return;
  }

  await createOtpChallenge({
    tenantId,
    email,
    purpose: "admin_login",
    metadata: { userId: user._id.toString(), firstName: user.firstName }
  });

  res.status(202).json({ message: "OTP sent to email" });
});

adminAuthRouter.post("/login/verify", async (req: TenantRequest, res) => {
  const parsed = adminOtpVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid OTP verification request", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();

  try {
    await consumeOtp({ tenantId, email, purpose: "admin_login", otp: parsed.data.otp });

    const user = await UserModel.findOne({ tenantId, email, role: { $in: ["admin", "staff"] } });
    if (!user) {
      res.status(404).json({ message: "Admin account not found" });
      return;
    }

    const tokens = buildAdminTokens({
      tenantId: user.tenantId,
      _id: user._id,
      role: normalizeAdminRole(user.role),
      permissions: user.permissions,
      email: user.email,
      accessLevel: user.accessLevel
    });

    user.refreshTokenHash = await hashValue(tokens.refreshToken);
    await user.save();

    res.json(tokens);
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

adminAuthRouter.post("/password-reset/request", async (req: TenantRequest, res) => {
  const parsed = adminPasswordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid reset request", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();
  const user = await UserModel.findOne({ tenantId, email, role: { $in: ["admin", "staff"] } });

  if (!user) {
    res.status(202).json({ message: "If account exists, OTP has been sent" });
    return;
  }

  await createOtpChallenge({
    tenantId,
    email,
    purpose: "admin_reset",
    metadata: { userId: user._id.toString(), firstName: user.firstName }
  });

  res.status(202).json({ message: "OTP sent to email" });
});

adminAuthRouter.post("/password-reset/confirm", async (req: TenantRequest, res) => {
  const parsed = adminPasswordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid reset confirmation", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();

  try {
    await consumeOtp({
      tenantId,
      email,
      purpose: "admin_reset",
      otp: parsed.data.otp
    });

    const user = await UserModel.findOne({ tenantId, email, role: { $in: ["admin", "staff"] } });
    if (!user) {
      res.status(404).json({ message: "Admin account not found" });
      return;
    }

    user.passwordHash = await hashValue(parsed.data.newPassword);
    user.refreshTokenHash = null;
    await user.save();

    res.json({ message: "Password reset completed" });
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

adminAuthRouter.post("/refresh", async (req: TenantRequest, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid refresh payload", issues: parsed.error.issues });
    return;
  }

  let payload: { tenantId: string; userId: string; role: string };
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  if (payload.tenantId !== req.tenantId) {
    res.status(403).json({ message: "Cross-tenant access denied" });
    return;
  }

  if (payload.role !== "admin" && payload.role !== "staff") {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  const user = await UserModel.findById(payload.userId);
  if (!user || (user.role !== "admin" && user.role !== "staff")) {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  const refreshOk = user.refreshTokenHash ? await compareValue(parsed.data.refreshToken, user.refreshTokenHash) : false;
  if (!refreshOk) {
    user.refreshTokenHash = null;
    await user.save();
    res.status(401).json({ message: "Refresh token reuse detected. Please login again." });
    return;
  }

  const tokens = buildAdminTokens({
    tenantId: user.tenantId,
    _id: user._id,
    role: normalizeAdminRole(user.role),
    permissions: user.permissions,
    email: user.email,
    accessLevel: user.accessLevel
  });

  user.refreshTokenHash = await hashValue(tokens.refreshToken);
  await user.save();

  res.json(tokens);
});

adminAuthRouter.post("/logout", async (req: TenantRequest, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid logout payload", issues: parsed.error.issues });
    return;
  }

  let payload: { tenantId: string; userId: string; role: string };
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    res.status(204).send();
    return;
  }

  if (payload.tenantId !== req.tenantId) {
    res.status(204).send();
    return;
  }

  const user = await UserModel.findById(payload.userId);
  if (user) {
    user.refreshTokenHash = null;
    await user.save();
  }

  res.status(204).send();
});
