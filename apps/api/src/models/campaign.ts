import { Schema, model, type InferSchemaType } from "mongoose";

const campaignSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true },
    segment: { type: String, enum: ["all", "champions", "loyal", "at_risk", "lost"], required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ["draft", "scheduled", "sent"], default: "draft" },
    sentAt: { type: Date, default: null },
    stats: {
      sent: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      purchased: { type: Number, default: 0 },
      revenueNgn: { type: Number, default: 0 }
    }
  },
  { timestamps: true }
);

campaignSchema.index({ tenantId: 1, createdAt: -1 });

export type CampaignDocument = InferSchemaType<typeof campaignSchema>;
export const CampaignModel = model("Campaign", campaignSchema);
