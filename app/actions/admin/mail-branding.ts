"use server";

/**
 * Server actions pour Paramètres > Habillage des mails.
 *
 * Sauvegarde des 2 configs JSON dans SiteConfig (`mail_header_config`,
 * `mail_footer_config`). Applique automatiquement aux mails qui utilisent
 * `wrapMail()` (newsletter, restock, panier abandonné, client inactif).
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { setSiteConfig } from "@/lib/site-config-write";
import { deleteFile, keyFromDbPath } from "@/lib/storage";
import { logger } from "@/lib/logger";
import {
  DEFAULT_MAIL_HEADER,
  DEFAULT_MAIL_FOOTER,
  readMailBrandingForTenant,
  type MailHeaderConfig,
  type MailFooterConfig,
  type MailBranding,
} from "@/lib/mail-branding";

/** Retourne la config actuelle (SSR-safe, non caché — pour l'écran de config). */
export async function getMailBranding(): Promise<MailBranding> {
  const { tenant } = await requireAdmin();
  return readMailBrandingForTenant(tenant.id);
}

/** Validation légère (couleurs hex, gradient CSS, URLs). */
function isHexColor(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}
function isUrlOrEmpty(v: string | null | undefined): boolean {
  if (!v || !v.trim()) return true;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}
function sanitizeGradient(v: string): string {
  // Accepte uniquement des dégradés CSS simples (pas d'expressions arbitraires).
  const trimmed = v.trim();
  if (!/^(linear|radial|conic)-gradient\([^;<>]{1,300}\)$/i.test(trimmed)) {
    throw new Error("Dégradé invalide (attendu : linear-gradient(…) ou radial-gradient(…)).");
  }
  return trimmed;
}

export async function updateMailHeaderConfig(
  input: Partial<MailHeaderConfig>,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const current = await getMailBranding();
    const merged: MailHeaderConfig = { ...current.header, ...input };

    // Validation
    if (merged.bgType !== "gradient" && merged.bgType !== "solid") {
      return { success: false, error: "Type de fond invalide." };
    }
    if (merged.bgType === "solid" && !isHexColor(merged.bgSolid)) {
      return { success: false, error: "Couleur de fond invalide." };
    }
    if (merged.bgType === "gradient") {
      try {
        merged.bgGradient = sanitizeGradient(merged.bgGradient);
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
    if (!isHexColor(merged.textColor)) {
      return { success: false, error: "Couleur du texte invalide." };
    }
    if (merged.logoUrl && merged.logoUrl.length > 500) {
      return { success: false, error: "URL du logo trop longue." };
    }
    if (typeof merged.logoMaxHeight !== "number" || merged.logoMaxHeight < 20 || merged.logoMaxHeight > 200) {
      return { success: false, error: "Hauteur du logo hors bornes (20-200 px)." };
    }

    // Nettoyage disque : si l'ancien logo était upload local et qu'on le change/supprime
    const prevLogo = current.header.logoUrl;
    if (prevLogo && prevLogo.startsWith("/uploads/") && prevLogo !== merged.logoUrl) {
      try {
        await deleteFile(keyFromDbPath(prevLogo));
      } catch (e) {
        logger.warn("[updateMailHeaderConfig] Anciennes photos non purgées", { error: e });
      }
    }

    await setSiteConfig("mail_header_config", JSON.stringify(merged));
    revalidateTag("mail-branding", "default");
    revalidatePath("/admin/parametres");
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (e) {
    logger.error("[updateMailHeaderConfig]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}

export async function updateMailFooterConfig(
  input: Partial<MailFooterConfig>,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const current = await getMailBranding();
    const merged: MailFooterConfig = { ...current.footer, ...input };

    if (!isHexColor(merged.bg)) {
      return { success: false, error: "Couleur de fond invalide." };
    }
    if (!isHexColor(merged.textColor)) {
      return { success: false, error: "Couleur du texte invalide." };
    }
    if (merged.customMessage && merged.customMessage.length > 500) {
      return { success: false, error: "Message perso trop long (max 500 caractères)." };
    }
    if (!isUrlOrEmpty(merged.instagramUrl)) {
      return { success: false, error: "URL Instagram invalide." };
    }
    if (!isUrlOrEmpty(merged.facebookUrl)) {
      return { success: false, error: "URL Facebook invalide." };
    }

    await setSiteConfig("mail_footer_config", JSON.stringify(merged));
    revalidateTag("mail-branding", "default");
    revalidatePath("/admin/parametres");
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (e) {
    logger.error("[updateMailFooterConfig]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}

/** Réinitialise l'habillage aux valeurs d'usine. */
export async function resetMailBranding(): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const current = await getMailBranding();
    // Purge du logo local si présent
    if (current.header.logoUrl?.startsWith("/uploads/")) {
      try {
        await deleteFile(keyFromDbPath(current.header.logoUrl));
      } catch { /* silent */ }
    }
    await Promise.all([
      prisma.siteConfig.deleteMany({ where: { key: "mail_header_config" } }),
      prisma.siteConfig.deleteMany({ where: { key: "mail_footer_config" } }),
    ]);
    revalidateTag("mail-branding", "default");
    revalidatePath("/admin/parametres");
    revalidatePath("/admin/marketing/mails");
    return { success: true };
  } catch (e) {
    logger.error("[resetMailBranding]", { error: e as Error });
    return { success: false, error: (e as Error).message };
  }
}

