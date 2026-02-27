import { Router } from "express";
import { customerRegisterVerifySchema, loginSchema, refreshSchema, registerSchema } from "@sws/shared-types";
import { z } from "zod";
import { UserModel } from "../models/user.js";
import { resolveTenantId } from "../services/tenant.js";
import type { AuthRequest } from "../middleware/auth.js";
import { requireCustomer } from "../middleware/auth.js";
import { compareValue, hashValue } from "../utils/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/tokens.js";
import { requireTenant } from "../middleware/tenant.js";
import { OtpChallengeModel } from "../models/otpChallenge.js";
import { enqueueCustomerOtpNotification } from "../services/notificationQueue.js";

export const authRouter = Router();

authRouter.use(requireTenant);

const OTP_EXPIRY_MINUTES = 10;
const registerAvailabilitySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(7)
});
const customerNotificationPreferenceSchema = z.object({
  notificationsEnabled: z.boolean()
});
const customerPasswordResetRequestSchema = z.object({
  email: z.string().email()
});
const customerPasswordResetConfirmSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  newPassword: z.string().min(8)
});

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createCustomerRegisterOtpChallenge(params: {
  tenantId: string;
  email: string;
  firstName: string;
  passwordHash: string;
  metadata: Record<string, unknown>;
}) {
  const code = generateOtp();
  const codeHash = await hashValue(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OtpChallengeModel.updateMany(
    {
      tenantId: params.tenantId,
      email: params.email,
      purpose: "customer_register",
      consumedAt: null
    },
    { $set: { consumedAt: new Date() } }
  );

  await OtpChallengeModel.create({
    tenantId: params.tenantId,
    email: params.email,
    purpose: "customer_register",
    codeHash,
    metadata: params.metadata,
    expiresAt
  });

  await enqueueCustomerOtpNotification({
    email: params.email,
    firstName: params.firstName,
    purpose: "customer_register",
    code,
    expiresInMinutes: OTP_EXPIRY_MINUTES
  });
}

async function consumeCustomerRegisterOtp(params: { tenantId: string; email: string; otp: string }) {
  const challenge = await OtpChallengeModel.findOne({
    tenantId: params.tenantId,
    email: params.email,
    purpose: "customer_register",
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

async function createCustomerResetOtpChallenge(params: { tenantId: string; email: string; firstName?: string }) {
  const code = generateOtp();
  const codeHash = await hashValue(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OtpChallengeModel.updateMany(
    {
      tenantId: params.tenantId,
      email: params.email,
      purpose: "customer_reset",
      consumedAt: null
    },
    { $set: { consumedAt: new Date() } }
  );

  await OtpChallengeModel.create({
    tenantId: params.tenantId,
    email: params.email,
    purpose: "customer_reset",
    codeHash,
    metadata: {},
    expiresAt
  });

  await enqueueCustomerOtpNotification({
    email: params.email,
    firstName: params.firstName,
    purpose: "customer_reset",
    code,
    expiresInMinutes: OTP_EXPIRY_MINUTES
  });
}

async function consumeCustomerResetOtp(params: { tenantId: string; email: string; otp: string }) {
  const challenge = await OtpChallengeModel.findOne({
    tenantId: params.tenantId,
    email: params.email,
    purpose: "customer_reset",
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
}

authRouter.post("/register/request", async (req: AuthRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid registration payload", issues: parsed.error.issues });
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

  const passwordHash = await hashValue(parsed.data.password);
  await createCustomerRegisterOtpChallenge({
    tenantId,
    email,
    firstName: parsed.data.firstName,
    passwordHash,
    metadata: {
      email,
      passwordHash,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      phone: parsed.data.phone,
      notificationsEnabled:
        typeof (req.body as { notificationsEnabled?: unknown })?.notificationsEnabled === "boolean"
          ? (req.body as { notificationsEnabled: boolean }).notificationsEnabled
          : true
    }
  });

  res.status(202).json({ message: "Verification code sent to email" });
});

authRouter.post("/register/availability", async (req: AuthRequest, res) => {
  const parsed = registerAvailabilitySchema.safeParse(req.body);
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

authRouter.post("/register/verify", async (req: AuthRequest, res) => {
  const parsed = customerRegisterVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid verification payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();

  try {
    const challenge = await consumeCustomerRegisterOtp({ tenantId, email, otp: parsed.data.otp });
    const metadata = challenge.metadata as {
      passwordHash: string;
      firstName: string;
      lastName: string;
      phone: string;
      notificationsEnabled?: boolean;
    };

    const existing = await UserModel.findOne({ tenantId, email });
    if (existing) {
      res.status(409).json({ message: "Account already exists" });
      return;
    }

    const user = await UserModel.create({
      tenantId,
      email,
      passwordHash: metadata.passwordHash,
      firstName: metadata.firstName,
      lastName: metadata.lastName,
      phone: metadata.phone,
      role: "customer",
      permissions: ["orders:read", "cart:write"],
      notificationsEnabled: metadata.notificationsEnabled ?? true
    });

    res.status(201).json({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    });
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});

authRouter.get("/me/preferences", requireCustomer, async (req: AuthRequest, res) => {
  const user = await UserModel.findById(req.claims!.userId).select({ notificationsEnabled: 1 }).lean();
  res.json({ notificationsEnabled: user?.notificationsEnabled ?? true });
});

authRouter.patch("/me/preferences", requireCustomer, async (req: AuthRequest, res) => {
  const parsed = customerNotificationPreferenceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid notification preference payload", issues: parsed.error.issues });
    return;
  }
  const user = await UserModel.findById(req.claims!.userId);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  user.notificationsEnabled = parsed.data.notificationsEnabled;
  await user.save();
  res.json({ notificationsEnabled: user.notificationsEnabled });
});

authRouter.post("/register", async (req: AuthRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid registration payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const existing = await UserModel.findOne({ tenantId, email: parsed.data.email.toLowerCase() });
  if (existing) {
    res.status(409).json({ message: "Account already exists" });
    return;
  }

  const passwordHash = await hashValue(parsed.data.password);
  const user = await UserModel.create({
    tenantId,
    email: parsed.data.email.toLowerCase(),
    passwordHash,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    phone: parsed.data.phone,
    role: "customer",
    permissions: ["orders:read", "cart:write"]
  });

  res.status(201).json({
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName
  });
});

authRouter.post("/login", async (req: AuthRequest, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid login payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = await resolveTenantId(req.tenantId!);
  const user = await UserModel.findOne({ tenantId, email: parsed.data.email.toLowerCase() });
  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const passwordOk = await compareValue(parsed.data.password, user.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const claims = {
    tenantId: user.tenantId.toString(),
    userId: user._id.toString(),
    role: user.role,
    permissions: user.permissions,
    twoFactorVerified: true
  } as const;

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken({ tenantId: claims.tenantId, userId: claims.userId, role: claims.role });
  user.refreshTokenHash = await hashValue(refreshToken);
  await user.save();

  res.json({ accessToken, refreshToken, user: { id: claims.userId, email: user.email, role: user.role } });
});

authRouter.post("/refresh", async (req: AuthRequest, res) => {
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

  const user = await UserModel.findById(payload.userId);
  if (!user) {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  const refreshOk = await compareValue(parsed.data.refreshToken, user.refreshTokenHash);
  if (!refreshOk) {
    res.status(401).json({ message: "Invalid refresh token" });
    return;
  }

  const claims = {
    tenantId: user.tenantId.toString(),
    userId: user._id.toString(),
    role: user.role,
    permissions: user.permissions,
    twoFactorVerified: true
  } as const;

  const accessToken = signAccessToken(claims);
  const refreshToken = signRefreshToken({ tenantId: claims.tenantId, userId: claims.userId, role: claims.role });
  user.refreshTokenHash = await hashValue(refreshToken);
  await user.save();

  res.json({ accessToken, refreshToken });
});

authRouter.post("/logout", async (req: AuthRequest, res) => {
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

  const user = await UserModel.findById(payload.userId);
  if (user) {
    user.refreshTokenHash = null;
    await user.save();
  }

  res.status(204).send();
});

authRouter.post("/password-reset/request", async (req: AuthRequest, res) => {
  const parsed = customerPasswordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid reset request payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();
  const user = await UserModel.findOne({ tenantId, email }).lean();

  if (user) {
    await createCustomerResetOtpChallenge({
      tenantId,
      email,
      firstName: user.firstName
    });
  }

  res.status(202).json({ message: "If that email exists, a reset OTP has been sent." });
});

authRouter.post("/password-reset/confirm", async (req: AuthRequest, res) => {
  const parsed = customerPasswordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid reset confirmation payload", issues: parsed.error.issues });
    return;
  }

  const tenantId = (await resolveTenantId(req.tenantId!)).toString();
  const email = parsed.data.email.toLowerCase();
  const user = await UserModel.findOne({ tenantId, email });
  if (!user) {
    res.status(401).json({ message: "Invalid reset attempt" });
    return;
  }

  try {
    await consumeCustomerResetOtp({ tenantId, email, otp: parsed.data.otp });
    user.passwordHash = await hashValue(parsed.data.newPassword);
    user.refreshTokenHash = null;
    await user.save();
    res.json({ message: "Password reset completed." });
  } catch (error) {
    res.status(401).json({ message: (error as Error).message });
  }
});
