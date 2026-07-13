"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { prisma } from "@/lib/prisma";
import {
  MIN_INTERVAL_MINUTES,
  toMinutes,
  type MailNotifySettings,
  type MailNotifyUnit,
} from "@/lib/mail-notify-constants";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
}

/**
 * Lit la config de notification mail non-lus pour le tenant courant.
 * Valeurs par défaut si aucune config posée : désactivé, mode "interval" 1 jour.
 */
export async function getMailNotifySettings(): Promise<MailNotifySettings> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: [
          "mail_notify_enabled",
          "mail_notify_email",
          "mail_notify_interval_value",
          "mail_notify_interval_unit",
          "mail_notify_forward_enabled",
        ],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const rawValue = map.get("mail_notify_interval_value");
  const parsedValue = rawValue ? parseInt(rawValue, 10) : NaN;
  const rawUnit = map.get("mail_notify_interval_unit");
  const unit: MailNotifyUnit =
    rawUnit === "minute" || rawUnit === "hour" || rawUnit === "day" ? rawUnit : "minute";

  return {
    enabled: map.get("mail_notify_enabled") === "true",
    email: map.get("mail_notify_email") || "",
    intervalValue: Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 30,
    intervalUnit: unit,
    forwardEnabled: map.get("mail_notify_forward_enabled") === "true",
  };
}

/**
 * Force un envoi de test pour le tenant courant (via ALS / headers).
 * Ignore l'intervalle et déclenche `sendMail()` immédiatement — utile pour
 * vérifier que la config marche sans attendre le prochain tick.
 */
export async function sendMailNotifyTest(): Promise<{
  success: boolean;
  error?: string;
  unread?: number;
}> {
  try {
    await requireAdmin();
    const { getCurrentTenantIdSync } = await import("@/lib/tenant-als");
    const { headers } = await import("next/headers");
    let tid = getCurrentTenantIdSync();
    if (!tid) {
      const h = await headers();
      tid = h.get("x-tenant-id");
    }
    if (!tid) return { success: false, error: "Tenant introuvable." };

    const { processTenantOnce } = await import("@/lib/mail-notify-worker");
    const res = await processTenantOnce(tid, { forceSend: true });
    if (res.action === "notified") return { success: true, unread: res.unread };
    if (res.action === "forwarded-only") return { success: true, unread: 0 };
    if (res.action === "error") return { success: false, error: res.error };
    return { success: false, error: `Ignoré : ${res.reason}` };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Persiste la config. Efface `mail_notify_last_sent_at` pour repartir sur un
 * cycle neuf de notifications dès qu'un paramètre change.
 */
export async function updateMailNotifySettings(
  data: MailNotifySettings
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (data.enabled) {
      const email = data.email?.trim();
      if (!email || !EMAIL_REGEX.test(email)) {
        return { success: false, error: "Adresse email invalide." };
      }
      if (!Number.isFinite(data.intervalValue) || data.intervalValue <= 0) {
        return { success: false, error: "L'intervalle doit être supérieur à 0." };
      }
      const unitsOk = ["minute", "hour", "day"].includes(data.intervalUnit);
      if (!unitsOk) return { success: false, error: "Unité d'intervalle invalide." };
      if (toMinutes(data.intervalValue, data.intervalUnit) < MIN_INTERVAL_MINUTES) {
        return {
          success: false,
          error: `L'intervalle minimum est de ${MIN_INTERVAL_MINUTES} minutes pour éviter le spam.`,
        };
      }
    }

    await Promise.all([
      setSiteConfig("mail_notify_enabled", data.enabled ? "true" : "false"),
      setSiteConfig("mail_notify_email", data.email?.trim() || ""),
      setSiteConfig("mail_notify_interval_value", String(Math.floor(data.intervalValue))),
      setSiteConfig("mail_notify_interval_unit", data.intervalUnit),
      setSiteConfig("mail_notify_forward_enabled", data.forwardEnabled ? "true" : "false"),
    ]);
    // Reset du dernier envoi pour repartir de zéro quand la config change.
    await unsetSiteConfig("mail_notify_last_sent_at");

    revalidatePath("/admin/parametres");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
