"use server";

/**
 * Server actions pour la désactivation automatique des clients inactifs.
 *
 * Pilote la tuile « Révocation automatique » de /admin/parametres + le bouton
 * « Réactiver » de la fiche client admin.
 *
 * 4 clés SiteConfig par tenant :
 *  - inactive_revoke_enabled (true/false)
 *  - inactive_revoke_warning_days (int ≥ 1)
 *  - inactive_revoke_grace_days (int ≥ 1)
 *  - inactive_revoke_probation_days (int ≥ 1)
 *
 * Les paramètres sont relus par le worker à chaque tick (1h) → pas besoin de
 * redémarrer le serveur pour changer les délais.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { setSiteConfig } from "@/lib/site-config-write";
import { notifyClientAccountReactivated } from "@/lib/notifications";
import { tenantALS } from "@/lib/tenant-als";
import {
  INACTIVE_REVOKE_ENABLED_KEY,
  INACTIVE_REVOKE_WARNING_DAYS_KEY,
  INACTIVE_REVOKE_GRACE_DAYS_KEY,
  INACTIVE_REVOKE_PROBATION_DAYS_KEY,
  INACTIVE_REVOKE_MIN_WARNING_DAYS,
  INACTIVE_REVOKE_MAX_WARNING_DAYS,
  INACTIVE_REVOKE_MIN_GRACE_DAYS,
  INACTIVE_REVOKE_MAX_GRACE_DAYS,
  INACTIVE_REVOKE_MIN_PROBATION_DAYS,
  INACTIVE_REVOKE_MAX_PROBATION_DAYS,
  parseWarningDays,
  parseGraceDays,
  parseProbationDays,
} from "@/lib/inactive-client-revoke-config";

export interface InactiveRevokeSettingsDTO {
  enabled: boolean;
  warningDays: number | null;
  graceDays: number | null;
  probationDays: number | null;
}

export async function getInactiveRevokeSettings(): Promise<InactiveRevokeSettingsDTO> {
  const { tenant } = await requireAdmin();
  const rows = await prisma.siteConfig.findMany({
    where: {
      tenantId: tenant.id,
      key: {
        in: [
          INACTIVE_REVOKE_ENABLED_KEY,
          INACTIVE_REVOKE_WARNING_DAYS_KEY,
          INACTIVE_REVOKE_GRACE_DAYS_KEY,
          INACTIVE_REVOKE_PROBATION_DAYS_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map.get(INACTIVE_REVOKE_ENABLED_KEY) === "true",
    warningDays: parseWarningDays(map.get(INACTIVE_REVOKE_WARNING_DAYS_KEY)),
    graceDays: parseGraceDays(map.get(INACTIVE_REVOKE_GRACE_DAYS_KEY)),
    probationDays: parseProbationDays(
      map.get(INACTIVE_REVOKE_PROBATION_DAYS_KEY),
    ),
  };
}

function validateDays(
  value: number | null | undefined,
  label: string,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: `${label} doit être un nombre entier.` };
  }
  if (value < min || value > max) {
    return {
      ok: false,
      error: `${label} doit être compris entre ${min} et ${max} jours.`,
    };
  }
  return { ok: true, value };
}

export async function updateInactiveRevokeSettings(input: {
  enabled: boolean;
  warningDays: number | null;
  graceDays: number | null;
  probationDays: number | null;
}): Promise<
  | { success: true; settings: InactiveRevokeSettingsDTO }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    const w = validateDays(
      input.warningDays,
      "Le délai avant avertissement",
      INACTIVE_REVOKE_MIN_WARNING_DAYS,
      INACTIVE_REVOKE_MAX_WARNING_DAYS,
    );
    if (!w.ok) return { success: false, error: w.error };

    const g = validateDays(
      input.graceDays,
      "Le délai de grâce",
      INACTIVE_REVOKE_MIN_GRACE_DAYS,
      INACTIVE_REVOKE_MAX_GRACE_DAYS,
    );
    if (!g.ok) return { success: false, error: g.error };

    const p = validateDays(
      input.probationDays,
      "La durée de probation",
      INACTIVE_REVOKE_MIN_PROBATION_DAYS,
      INACTIVE_REVOKE_MAX_PROBATION_DAYS,
    );
    if (!p.ok) return { success: false, error: p.error };

    // Activer la désactivation auto nécessite les 2 délais du cycle normal.
    // La probation n'est pas obligatoire pour activer (le worker tourne sans)
    // mais empêchera la cliente de réactiver un compte depuis l'UI.
    if (input.enabled && (w.value === null || g.value === null)) {
      return {
        success: false,
        error: "Pour activer la désactivation automatique, renseignez le délai avant avertissement et le délai de grâce.",
      };
    }

    const writeOrDelete = async (
      key: string,
      value: number | null,
    ): Promise<void> => {
      if (value === null) {
        await prisma.siteConfig.deleteMany({
          where: { tenantId: tenant.id, key },
        });
      } else {
        await setSiteConfig(key, String(value), { tenantId: tenant.id });
      }
    };

    await Promise.all([
      setSiteConfig(
        INACTIVE_REVOKE_ENABLED_KEY,
        input.enabled ? "true" : "false",
        { tenantId: tenant.id },
      ),
      writeOrDelete(INACTIVE_REVOKE_WARNING_DAYS_KEY, w.value),
      writeOrDelete(INACTIVE_REVOKE_GRACE_DAYS_KEY, g.value),
      writeOrDelete(INACTIVE_REVOKE_PROBATION_DAYS_KEY, p.value),
    ]);

    revalidatePath("/admin/parametres");
    return {
      success: true,
      settings: {
        enabled: input.enabled,
        warningDays: w.value,
        graceDays: g.value,
        probationDays: p.value,
      },
    };
  } catch (err) {
    logger.error("[updateInactiveRevokeSettings]", { error: err as Error });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

/**
 * Info d'affichage « prochain évènement de désactivation auto » pour un
 * client APPROVED. Utilisé par le tableau /admin/marketing (onglet Envoyer).
 */
export type InactiveRevokeNextEventType =
  | "warning" // prochain mail d'avertissement
  | "deactivation" // bascule APPROVED → DEACTIVATED (pas de nouveau mail avant)
  | "probation_end"; // fin de probation (si pas de commande d'ici là)

export interface InactiveRevokeNextEvent {
  type: InactiveRevokeNextEventType;
  nextAt: Date;
}

/**
 * Pour chaque userId donné (APPROVED uniquement, les autres sont ignorés),
 * calcule l'évènement de désactivation auto suivant. Renvoie Map(userId →
 * event). Les clients qui n'auront aucun évènement (ex. tenant qui n'a pas
 * activé la feature) ne sont pas dans la Map.
 */
export async function loadInactiveRevokeInfoFor(
  userIds: string[],
): Promise<Map<string, InactiveRevokeNextEvent>> {
  const map = new Map<string, InactiveRevokeNextEvent>();
  if (userIds.length === 0) return map;

  const { tenant } = await requireAdmin();

  const configRows = await prisma.siteConfig.findMany({
    where: {
      tenantId: tenant.id,
      key: {
        in: [
          INACTIVE_REVOKE_ENABLED_KEY,
          INACTIVE_REVOKE_WARNING_DAYS_KEY,
          INACTIVE_REVOKE_GRACE_DAYS_KEY,
          INACTIVE_REVOKE_PROBATION_DAYS_KEY,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const configMap = new Map(configRows.map((r) => [r.key, r.value]));
  if (configMap.get(INACTIVE_REVOKE_ENABLED_KEY) !== "true") return map;
  const warningDays = parseWarningDays(
    configMap.get(INACTIVE_REVOKE_WARNING_DAYS_KEY),
  );
  const graceDays = parseGraceDays(
    configMap.get(INACTIVE_REVOKE_GRACE_DAYS_KEY),
  );
  if (warningDays === null || graceDays === null) return map;

  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      tenantId: tenant.id,
      role: "CLIENT",
      status: "APPROVED",
      inactiveClientOptOut: false,
    },
    select: {
      id: true,
      createdAt: true,
      inactivityWarningAt: true,
      probationUntil: true,
    },
  });
  if (users.length === 0) return map;

  const lastOrders = await prisma.order.groupBy({
    by: ["userId"],
    where: { tenantId: tenant.id, userId: { in: users.map((u) => u.id) } },
    _max: { createdAt: true },
  });
  const lastOrderByUser = new Map(
    lastOrders.map((row) => [row.userId, row._max.createdAt]),
  );

  for (const u of users) {
    // Priorité 1 : probation en cours → afficher la fin de probation.
    if (u.probationUntil !== null) {
      map.set(u.id, { type: "probation_end", nextAt: u.probationUntil });
      continue;
    }

    const referenceAt = lastOrderByUser.get(u.id) ?? u.createdAt;

    // Priorité 2 : avertissement déjà envoyé → afficher date de désactivation.
    //   deactivation = inactivityWarningAt + graceDays
    //   (sauf si le client a commandé après l'avertissement, auquel cas
    //   l'avertissement est caduc et on repart sur le cycle normal).
    const warningStillValid =
      u.inactivityWarningAt !== null &&
      u.inactivityWarningAt.getTime() >= referenceAt.getTime();
    if (warningStillValid) {
      const nextAt = new Date(
        u.inactivityWarningAt!.getTime() + graceDays * 86_400_000,
      );
      map.set(u.id, { type: "deactivation", nextAt });
      continue;
    }

    // Priorité 3 : date théorique d'envoi du prochain avertissement.
    //   warning = referenceAt + warningDays
    const nextAt = new Date(referenceAt.getTime() + warningDays * 86_400_000);
    map.set(u.id, { type: "warning", nextAt });
  }

  return map;
}

/**
 * Réactive un client désactivé pour inactivité avec période de probation.
 * - Bascule status DEACTIVATED → APPROVED.
 * - Pose probationUntil = now + probationDays (lu depuis les paramètres).
 * - Clear inactivityWarningAt + deactivatedForInactivityAt.
 * - Envoie le mail « Compte réactivé » au client.
 *
 * Refusé si le tenant n'a pas de probationDays configuré ou si le client
 * n'est pas en status DEACTIVATED.
 */
export async function reactivateInactiveClient(userId: string): Promise<
  | { success: true; probationUntil: Date }
  | { success: false; error: string }
> {
  try {
    const { tenant } = await requireAdmin();

    // Vérifie le paramètre probationDays du tenant.
    const probationRow = await prisma.siteConfig.findFirst({
      where: {
        tenantId: tenant.id,
        key: INACTIVE_REVOKE_PROBATION_DAYS_KEY,
      },
      select: { value: true },
    });
    const probationDays = parseProbationDays(probationRow?.value);
    if (probationDays === null) {
      return {
        success: false,
        error:
          "Configurez d'abord la durée de probation dans Paramètres → Inscription → Révocation automatique.",
      };
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId: tenant.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        status: true,
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    if (user.status !== "DEACTIVATED") {
      return {
        success: false,
        error: "Ce client n'est pas désactivé pour inactivité.",
      };
    }

    const now = new Date();
    const probationUntil = new Date(
      now.getTime() + probationDays * 86_400_000,
    );

    await prisma.user.update({
      where: { id: userId },
      data: {
        status: "APPROVED",
        probationUntil,
        inactivityWarningAt: null,
        deactivatedForInactivityAt: null,
      },
    });

    // Mail de réactivation fire-and-forget, wrappé dans l'ALS tenant courant
    // pour que les helpers cachés (shopName, baseUrl) résolvent bien.
    const tenantId = tenant.id;
    void tenantALS.run(tenantId, async () => {
      await notifyClientAccountReactivated({
        email: user.email,
        firstName: user.firstName,
        probationDays,
      });
    });

    revalidatePath(`/admin/clients/${userId}`);
    revalidatePath("/admin/clients");
    return { success: true, probationUntil };
  } catch (err) {
    logger.error("[reactivateInactiveClient]", { userId, error: err as Error });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}
