import { Router } from "express";
import type { TenantRequest } from "../middleware/tenant.js";
import { resolveTenantId } from "../services/tenant.js";
import { ContentSettingsModel } from "../models/contentSettings.js";

export const contentRouter = Router();

contentRouter.get("/", async (req: TenantRequest, res) => {
  const tenantId = await resolveTenantId(req.tenantId!);
  const settings =
    (await ContentSettingsModel.findOne({ tenantId }).lean()) ??
    (await ContentSettingsModel.create({ tenantId }));

  res.json({
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    heroCtaLabel: settings.heroCtaLabel,
    heroCtaPath: settings.heroCtaPath,
    promoStripText: settings.promoStripText,
    featuredCategorySlugs: settings.featuredCategorySlugs
  });
});
