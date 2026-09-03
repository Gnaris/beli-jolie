/**
 * Habillage des mails — helpers serveur.
 *
 * Consomme SiteConfig (`mail_header_config`, `mail_footer_config`) et expose :
 *   - `getCachedMailBranding()` : lecture cachée scopée tenant (tag `mail-branding`)
 *   - `readMailBrandingForTenant(tenantId)` : lecture directe hors requête
 *
 * Les types + défauts + helpers purs sont dans `mail-branding-types.ts`
 * (import-safe côté client). Ce fichier les réexporte pour éviter les
 * doubles imports.
 */

import { prisma } from "@/lib/prisma";
import { tenantScopedCacheWithTid } from "@/lib/cached-data";
import {
  DEFAULT_MAIL_BRANDING,
  parseHeaderConfig,
  parseFooterConfig,
  type MailBranding,
} from "@/lib/mail-branding-types";

export * from "@/lib/mail-branding-types";

/** Lecture cachée (tag `mail-branding`, TTL 5 min). */
export const getCachedMailBranding = tenantScopedCacheWithTid(
  "mail-branding",
  async (tid): Promise<MailBranding> => {
    if (tid === "global") return DEFAULT_MAIL_BRANDING;
    const [headerRow, footerRow] = await Promise.all([
      prisma.siteConfig.findFirst({
        where: { tenantId: tid, key: "mail_header_config" },
        select: { value: true },
      }),
      prisma.siteConfig.findFirst({
        where: { tenantId: tid, key: "mail_footer_config" },
        select: { value: true },
      }),
    ]);
    return {
      header: parseHeaderConfig(headerRow?.value),
      footer: parseFooterConfig(footerRow?.value),
    };
  },
  ["mail-branding"],
  { revalidate: 300, tags: ["mail-branding"] }
);

/** Lecture directe (scripts, workers, admin actions post-save). */
export async function readMailBrandingForTenant(tenantId: string): Promise<MailBranding> {
  const [headerRow, footerRow] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId, key: "mail_header_config" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId, key: "mail_footer_config" },
      select: { value: true },
    }),
  ]);
  return {
    header: parseHeaderConfig(headerRow?.value),
    footer: parseFooterConfig(footerRow?.value),
  };
}
