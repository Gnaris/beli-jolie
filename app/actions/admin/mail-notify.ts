"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import type { MailForwardStatus } from "@/lib/mail-notify-constants";
import { KEY_VERIFIED_EMAIL } from "./admin-personal-email-constants";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
}

/**
 * Lit l'état du transfert pour le tenant courant. Le transfert est actif
 * dès qu'une adresse perso est vérifiée ET que le SMTP est configuré.
 */
export async function getMailForwardStatus(): Promise<MailForwardStatus> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: {
        in: [KEY_VERIFIED_EMAIL, "smtp_from_email", "smtp_host", "smtp_user", "smtp_password"],
      },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const personalEmail = (map.get(KEY_VERIFIED_EMAIL) || "").trim();
  const proEmail = map.get("smtp_from_email")
    ? decryptIfSensitive("smtp_from_email", map.get("smtp_from_email")!).trim()
    : "";
  const smtpHost = map.get("smtp_host")
    ? decryptIfSensitive("smtp_host", map.get("smtp_host")!).trim()
    : "";
  const smtpUser = map.get("smtp_user")
    ? decryptIfSensitive("smtp_user", map.get("smtp_user")!).trim()
    : "";
  const smtpPassword = map.get("smtp_password")
    ? decryptIfSensitive("smtp_password", map.get("smtp_password")!).trim()
    : "";

  const canForward = Boolean(personalEmail && smtpHost && smtpUser && smtpPassword);
  return { personalEmail, proEmail, canForward };
}

/**
 * Envoie un mail de test à l'adresse perso vérifiée du tenant courant pour
 * vérifier que le transfert fonctionne, sans attendre le prochain tick du
 * worker.
 */
export async function sendMailNotifyTest(): Promise<{
  success: boolean;
  error?: string;
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
    if (res.action === "test-sent") return { success: true };
    if (res.action === "error") return { success: false, error: res.error };
    if (res.action === "skip") {
      const reason =
        res.reason === "not-configured"
          ? "Vérifiez qu'une adresse perso est vérifiée et que le SMTP est configuré."
          : `Ignoré : ${res.reason}`;
      return { success: false, error: reason };
    }
    return { success: false, error: "Réponse inattendue." };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Lit les valeurs SMTP publiques (host + port + user + from) utilisées par
 * le tutoriel Gmail pour afficher les infos à copier-coller. Le mot de
 * passe n'est PAS renvoyé — il est réinitialisable via la carte sécurité.
 */
export async function getSmtpPublicConfig(): Promise<{
  host: string;
  port: number;
  user: string;
  fromEmail: string;
  shopName: string;
}> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["smtp_host", "smtp_port", "smtp_user", "smtp_from_email", "shop_name"] } },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const host = map.get("smtp_host")
    ? decryptIfSensitive("smtp_host", map.get("smtp_host")!).trim()
    : "";
  const rawPort = map.get("smtp_port")
    ? decryptIfSensitive("smtp_port", map.get("smtp_port")!).trim()
    : "";
  const parsedPort = parseInt(rawPort, 10);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587;
  const user = map.get("smtp_user")
    ? decryptIfSensitive("smtp_user", map.get("smtp_user")!).trim()
    : "";
  const fromEmail = map.get("smtp_from_email")
    ? decryptIfSensitive("smtp_from_email", map.get("smtp_from_email")!).trim()
    : "";
  const shopName = (map.get("shop_name") || "").trim();

  return { host, port, user, fromEmail, shopName };
}
