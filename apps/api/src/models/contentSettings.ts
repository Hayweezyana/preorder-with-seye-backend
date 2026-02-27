import { Schema, model, type InferSchemaType } from "mongoose";

const contentSettingsSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true, index: true },
    heroTitle: { type: String, default: "Shop the latest arrivals." },
    heroSubtitle: { type: String, default: "Browse products, add to cart, and checkout securely." },
    heroCtaLabel: { type: String, default: "Start Shopping" },
    heroCtaPath: { type: String, default: "/shop" },
    promoStripText: { type: String, default: "Fast shipping nationwide - secure checkout - curated quality picks." },
    featuredCategorySlugs: { type: [String], default: [] }
  },
  { timestamps: true }
);

export type ContentSettingsDocument = InferSchemaType<typeof contentSettingsSchema>;
export const ContentSettingsModel = model("ContentSettings", contentSettingsSchema);
