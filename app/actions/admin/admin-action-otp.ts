"use server";

/**
 * app/actions/admin/admin-action-otp.ts
 *
 * Server action appelée depuis la modale UI (<OtpConfirmDialog>) pour
 * demander l'envoi d'un code OTP par email avant une action destructive.
 * Vérifie le tenant + l'admin, court-circuite si une pause est active.
 */

import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  createOtpForAction,
  isOtpPauseActive,
  applyPauseChoice,
  verifyAndConsumeOtp,
  type AdminActionKind,
  type PauseChoice,
} from "@/lib/admin-action-otp";

const ActionSchema = z.enum(["delete", "refresh", "archive"]);

const RequestSchema = z.object({
  action: ActionSchema,
  productIds: z.array(z.string().min(1)).min(1).max(500),
});

export type RequestOtpResult =
  | {
      success: true;
      /** True si aucun code n'est nécessaire (pause active) — l'UI enchaîne direct. */
      bypassedByPause: true;
    }
  | {
      success: true;
      bypassedByPause: false;
      otpId: string;
      /** Email destinataire masqué (ex: "con••••••@beliandjolie.com"). */
      recipientMasked: string;
      /** Timestamp d'expiration (ms), pour countdown côté UI. */
      expiresAt: number;
    }
  | {
      success: false;
      error: string;
    };

export async function requestAdminActionOtp(input: {
  action: AdminActionKind;
  productIds: string[];
}): Promise<RequestOtpResult> {
  let parsed;
  try {
    parsed = RequestSchema.parse(input);
  } catch (err) {
    const msg =
      err && typeof err === "object" && "issues" in err
        ? "Paramètres invalides."
        : "Erreur inconnue.";
    return { success: false, error: msg };
  }

  const { session, tenant } = await requireAdmin();
  const adminId = session.user.id;

  if (await isOtpPauseActive(tenant.id)) {
    return { success: true, bypassedByPause: true };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: parsed.productIds } },
    select: { id: true, reference: true, name: true },
  });

  if (products.length === 0) {
    return { success: false, error: "Aucun produit trouvé." };
  }

  const result = await createOtpForAction({
    action: parsed.action,
    productIds: products.map((p) => p.id),
    productLabels: products.map((p) => ({ reference: p.reference, name: p.name })),
    adminId,
    tenantId: tenant.id,
  });

  if (!result.success) {
    const errorMsg =
      result.reason === "no_recipient"
        ? "Aucun email admin configuré. Renseignez l'adresse pro dans Paramètres > Société avant d'utiliser la vérification par code."
        : "Impossible d'envoyer le code par mail. Vérifiez la configuration SMTP.";
    logger.warn("[admin-action-otp] Échec requestAdminActionOtp", {
      adminId,
      tenantId: tenant.id,
      reason: result.reason,
    });
    return { success: false, error: errorMsg };
  }

  return {
    success: true,
    bypassedByPause: false,
    otpId: result.otpId,
    recipientMasked: result.recipientMasked,
    expiresAt: result.expiresAt,
  };
}

/**
 * Applique le choix de pause (« Ne plus me demander pendant X »).
 * Appelé juste après une confirmation OTP réussie si l'admin a coché autre chose
 * que « Toujours me prévenir ».
 */
export async function setAdminActionOtpPause(
  pause: PauseChoice
): Promise<{ success: boolean; error?: string }> {
  try {
    const { tenant } = await requireAdmin();
    await applyPauseChoice(tenant.id, pause);
    return { success: true };
  } catch (err) {
    logger.error("[admin-action-otp] Erreur applyPauseChoice", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: "Impossible d'enregistrer la pause." };
  }
}

/**
 * Retourne si une pause est actuellement active (pour l'UI, pour cacher
 * la modale entièrement pendant la pause).
 */
export async function getAdminActionOtpPauseStatus(): Promise<{
  active: boolean;
}> {
  const { tenant } = await requireAdmin();
  return { active: await isOtpPauseActive(tenant.id) };
}

const VerifyForRefreshSchema = z.object({
  otpId: z.string().min(1),
  code: z.string().min(1),
  productIds: z.array(z.string().min(1)).min(1),
  pauseChoice: z.enum(["15min", "1h", "24h"]).nullable().optional(),
});

/**
 * Vérifie l'OTP pour un flow de rafraîchissement bulk (le hook UI enchaîne
 * ensuite plusieurs appels `refreshProductOnMarketplaces`, un par produit).
 * Consomme l'OTP côté serveur puis applique éventuellement la pause.
 *
 * Note : la vérification est atomique côté serveur ici. Les appels suivants
 * de `refreshProductOnMarketplaces` restent classiques (admin session
 * required — pas de guard OTP au niveau de chaque produit du lot).
 */
export async function verifyAdminActionOtpForRefresh(input: {
  otpId: string;
  code: string;
  productIds: string[];
  pauseChoice?: PauseChoice;
}): Promise<{ success: boolean; error?: string }> {
  let parsed;
  try {
    parsed = VerifyForRefreshSchema.parse(input);
  } catch {
    return { success: false, error: "Paramètres invalides." };
  }

  const { session, tenant } = await requireAdmin();
  const adminId = session.user.id;

  if (await isOtpPauseActive(tenant.id)) {
    return { success: true };
  }

  const result = await verifyAndConsumeOtp({
    otpId: parsed.otpId,
    code: parsed.code,
    action: "refresh",
    adminId,
    tenantId: tenant.id,
    productIds: parsed.productIds,
  });

  if (!result.success) {
    const map: Record<string, string> = {
      not_found: "Code introuvable ou déjà utilisé.",
      expired: "Le code a expiré, redemandez-en un.",
      invalid_code: "Code incorrect.",
      too_many_attempts: "Trop de tentatives. Redemandez un nouveau code.",
      wrong_scope: "Le code ne correspond pas à cette opération.",
    };
    return { success: false, error: map[result.reason] ?? "Vérification échouée." };
  }

  if (parsed.pauseChoice) {
    await applyPauseChoice(tenant.id, parsed.pauseChoice);
  }
  return { success: true };
}
