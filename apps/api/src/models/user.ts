import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: true },
    role: { type: String, enum: ["customer", "admin", "staff"], default: "customer" },
    accessLevel: { type: String, enum: ["owner", "manager", "staff"], default: undefined },
    permissions: { type: [String], default: [] },
    notificationsEnabled: { type: Boolean, default: true },
    refreshTokenHash: { type: String, default: null }
  },
  { timestamps: true }
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const UserModel = model("User", userSchema);
