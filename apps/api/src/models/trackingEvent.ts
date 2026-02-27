import { Schema, model, type InferSchemaType } from "mongoose";

const trackingEventSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    provider: { type: String, required: true },
    externalTrackingId: { type: String, required: true },
    status: {
      type: String,
      enum: ["label_created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception"],
      required: true
    },
    location: { type: String, default: null },
    message: { type: String, default: null },
    eventAt: { type: Date, required: true },
    raw: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

trackingEventSchema.index({ tenantId: 1, orderId: 1, eventAt: -1 });
trackingEventSchema.index({ tenantId: 1, provider: 1, externalTrackingId: 1 });

export type TrackingEventDocument = InferSchemaType<typeof trackingEventSchema>;
export const TrackingEventModel = model("TrackingEvent", trackingEventSchema);
