import { Schema, model, type InferSchemaType } from "mongoose";

const adminAuditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, default: null },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

adminAuditLogSchema.index({ tenantId: 1, createdAt: -1 });

export type AdminAuditLogDocument = InferSchemaType<typeof adminAuditLogSchema>;
export const AdminAuditLogModel = model("AdminAuditLog", adminAuditLogSchema);
