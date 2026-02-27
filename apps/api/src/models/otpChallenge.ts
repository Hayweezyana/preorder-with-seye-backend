import { Schema, model, type InferSchemaType } from "mongoose";

const otpChallengeSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: true, index: true },
    purpose: {
      type: String,
      enum: ["admin_register", "admin_login", "admin_reset", "customer_register", "customer_reset"],
      required: true,
      index: true
    },
    codeHash: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

otpChallengeSchema.index({ tenantId: 1, email: 1, purpose: 1, createdAt: -1 });

export type OtpChallengeDocument = InferSchemaType<typeof otpChallengeSchema>;
export const OtpChallengeModel = model("OtpChallenge", otpChallengeSchema);
