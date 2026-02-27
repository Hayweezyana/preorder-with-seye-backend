import { z } from "zod";

export const authClaimsSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["customer", "admin", "staff"]),
  permissions: z.array(z.string()),
  twoFactorVerified: z.boolean()
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().min(7)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10)
});

export const customerRegisterRequestSchema = registerSchema;
export const customerRegisterVerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6)
});

export const cartItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(20)
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(20)
});

export const checkoutInitSchema = z
  .object({
    email: z.string().email(),
    addressId: z.string().min(1).optional(),
    shippingAddress: z.string().min(5).optional(),
    city: z.string().min(2).optional(),
    state: z.string().min(2).optional()
  })
  .superRefine((value, context) => {
    const hasAddressId = Boolean(value.addressId);
    const hasManualAddress = Boolean(value.shippingAddress && value.city && value.state);
    if (!hasAddressId && !hasManualAddress) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide addressId or shippingAddress/city/state",
        path: ["addressId"]
      });
    }
  });

export const reportExportSchema = z.object({
  format: z.enum(["csv", "pdf"]),
  from: z.string(),
  to: z.string(),
  groupBy: z.enum(["day", "week", "month"]).optional()
});

export const campaignCreateSchema = z.object({
  name: z.string().min(3),
  segment: z.enum(["all", "champions", "loyal", "at_risk", "lost"]),
  subject: z.string().min(3),
  body: z.string().min(10)
});

export const adminOrderStatusUpdateSchema = z.object({
  status: z.enum(["pending", "processing", "paid", "shipped", "delivered", "cancelled"]),
  trackingNumber: z.string().min(3).optional(),
  note: z.string().max(240).optional()
});

export const adminAccessLevelSchema = z.enum(["owner", "manager", "staff"]);
export const adminUserAccessLevelUpdateSchema = z.object({
  accessLevel: adminAccessLevelSchema
});

export const adminRegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().min(7),
  accessLevel: adminAccessLevelSchema.default("staff")
});

export const adminOtpVerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6)
});

export const adminLoginRequestSchema = z.object({
  email: z.string().email()
});

export const adminPasswordResetRequestSchema = z.object({
  email: z.string().email()
});

export const adminPasswordResetConfirmSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  newPassword: z.string().min(8)
});

export type AuthClaims = z.infer<typeof authClaimsSchema>;
export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
export type RefreshRequest = z.infer<typeof refreshSchema>;
export type CustomerRegisterRequest = z.infer<typeof customerRegisterRequestSchema>;
export type CustomerRegisterVerifyRequest = z.infer<typeof customerRegisterVerifySchema>;
export type CartItemInput = z.infer<typeof cartItemSchema>;
export type CheckoutInitRequest = z.infer<typeof checkoutInitSchema>;
export type ReportExportRequest = z.infer<typeof reportExportSchema>;
export type CampaignCreateRequest = z.infer<typeof campaignCreateSchema>;
export type AdminOrderStatusUpdateRequest = z.infer<typeof adminOrderStatusUpdateSchema>;
export type AdminAccessLevel = z.infer<typeof adminAccessLevelSchema>;
export type AdminUserAccessLevelUpdateRequest = z.infer<typeof adminUserAccessLevelUpdateSchema>;
export type AdminRegisterRequest = z.infer<typeof adminRegisterRequestSchema>;
export type AdminOtpVerifyRequest = z.infer<typeof adminOtpVerifySchema>;
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;
export type AdminPasswordResetRequest = z.infer<typeof adminPasswordResetRequestSchema>;
export type AdminPasswordResetConfirmRequest = z.infer<typeof adminPasswordResetConfirmSchema>;
