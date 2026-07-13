"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import { prisma } from "@/lib/prisma";
import {
  MIN_INTERVAL_MINUTES,
  toMinutes,
  type MailNotifyMode,
  type MailNotifySettings,
  type MailNotifyUnit,
} from "@/lib/mail-notify-constants";
import { KEY_VERIFIED_EMAIL } from "./admin-personal-email-constants";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
}

function parseMode(raw: string | undefined): MailNotifyMode {
  if (raw === "summary" || raw === "forward" || raw === "off") return raw;
  return "off";
}

/**
 * Lit la config de notification pour le tenant courant.
 * L'adresse perso vient de `admin_personal_email` (source de vérité unique).
 * Valeurs par défaut si aucune config posée : mode "off", intervalle 1 jour.
 */
export async function getMailNotifySettings(): Promise<MailNotifySettings> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: [
          "mail_notify_mode",
          "mail_notify_interval_value",
          "mail_notify_interval_unit",
          KEY_VERIFIED_EMAIL,
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
    rawUnit === "minute" || rawUnit === "hour" || rawUnit === "day" ? rawUnit : "hour";

  return {
    mode: parseMode(map.get("mail_notify_mode")),
    intervalValue: Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1,
    intervalUnit: unit,
    personalEmail: (map.get(KEY_VERIFIED_EMAIL) || "").trim(),
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
 *
 * Le champ `personalEmail` du form est ignoré ici : il est géré par le flow
 * OTP séparé (`admin-personal-email.ts`).
 */
export async function updateMailNotifySettings(
  data: Pick<MailNotifySettings, "mode" | "intervalValue" | "intervalUnit">
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (data.mode !== "off" && data.mode !== "summary" && data.mode !== "forward") {
      return { success: false, error: "Mode de notification invalide." };
    }

    if (data.mode === "summary") {
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

    // Pour activer une notification, il faut un mail perso vérifié.
    if (data.mode !== "off") {
      const persoRow = await prisma.siteConfig.findFirst({
        where: { key: KEY_VERIFIED_EMAIL },
        select: { value: true },
      });
      const perso = (persoRow?.value || "").trim();
      if (!perso) {
        return {
          success: false,
          error:
            "Aucune adresse perso vérifiée. Configurez-la d'abord en haut de cette page.",
        };
      }
    }

    await Promise.all([
      setSiteConfig("mail_notify_mode", data.mode),
      setSiteConfig("mail_notify_interval_value", String(Math.floor(data.intervalValue))),
      setSiteConfig("mail_notify_interval_unit", data.intervalUnit),
    ]);
    // Reset du dernier envoi pour repartir de zéro quand la config change.
    await unsetSiteConfig("mail_notify_last_sent_at");

    revalidatePath("/admin/parametres");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
