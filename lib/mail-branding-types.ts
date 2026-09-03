/**
 * Types + défauts + helpers PURS pour l'habillage des mails.
 *
 * Ce fichier N'IMPORTE PAS Prisma, next/headers, ni aucun helper serveur —
 * il peut être consommé depuis un Client Component (`MailBrandingSection`,
 * `NewsletterEditorClient`) sans faire tomber le bundle.
 *
 * Les fonctions serveur (`getCachedMailBranding`, `readMailBrandingForTenant`)
 * vivent dans `lib/mail-branding.ts` qui réexporte tout ce module.
 */

export type MailHeaderBgType = "gradient" | "solid";

export interface MailHeaderConfig {
  bgType: MailHeaderBgType;
  bgGradient: string;
  bgSolid: string;
  textColor: string;
  logoUrl: string | null;
  logoMaxHeight: number;
  showShopName: boolean;
}

export interface MailFooterConfig {
  bg: string;
  textColor: string;
  customMessage: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
}

export interface MailBranding {
  header: MailHeaderConfig;
  footer: MailFooterConfig;
}

export const DEFAULT_MAIL_HEADER: MailHeaderConfig = {
  bgType: "gradient",
  bgGradient: "linear-gradient(135deg,#0f172a,#334155)",
  bgSolid: "#0f172a",
  textColor: "#ffffff",
  logoUrl: null,
  logoMaxHeight: 48,
  showShopName: true,
};

export const DEFAULT_MAIL_FOOTER: MailFooterConfig = {
  bg: "#0f172a",
  textColor: "#ffffff",
  customMessage: null,
  instagramUrl: null,
  facebookUrl: null,
};

export const DEFAULT_MAIL_BRANDING: MailBranding = {
  header: DEFAULT_MAIL_HEADER,
  footer: DEFAULT_MAIL_FOOTER,
};

export function resolveHeaderBackground(header: MailHeaderConfig): string {
  return header.bgType === "solid" ? header.bgSolid : header.bgGradient;
}

/** Parsing tolérant d'une valeur SiteConfig JSON. */
export function parseHeaderConfig(raw: string | null | undefined): MailHeaderConfig {
  if (!raw) return DEFAULT_MAIL_HEADER;
  try {
    const parsed = JSON.parse(raw) as Partial<MailHeaderConfig>;
    return { ...DEFAULT_MAIL_HEADER, ...parsed };
  } catch {
    return DEFAULT_MAIL_HEADER;
  }
}

export function parseFooterConfig(raw: string | null | undefined): MailFooterConfig {
  if (!raw) return DEFAULT_MAIL_FOOTER;
  try {
    const parsed = JSON.parse(raw) as Partial<MailFooterConfig>;
    return { ...DEFAULT_MAIL_FOOTER, ...parsed };
  } catch {
    return DEFAULT_MAIL_FOOTER;
  }
}
