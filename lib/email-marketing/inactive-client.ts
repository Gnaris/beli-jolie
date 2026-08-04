/**
 * lib/email-marketing/inactive-client.ts
 *
 * Scanne les clients APPROVED qui ne se sont pas connectés depuis longtemps
 * et envoie un email doux "on ne vous a pas vu depuis…".
 *
 * Règles de détection :
 *   - `User.role = "CLIENT"` et `status = "APPROVED"`.
 *   - `max(lastLoginAt, lastSeenAt) < now - inactiveAfterDays`
 *     (défaut 30 jours). Si les deux sont null (jamais connecté), on ne relance
 *     PAS — c'est le job du scénario Bienvenue de traiter les nouveaux.
 *   - Aucune ligne EmailSend INACTIVE_CLIENT pour ce user dans la fenêtre
 *     `cooldownDays` (défaut 60 jours). Empêche de relancer un client
 *     qui reste durablement inactif toutes les 15 minutes.
 *   - Pas de désabonnement INACTIVE_REMINDERS ni MARKETING_ALL.
 *
 * Idempotent : contrainte unique EmailSend(tenantId, scenarioKey, dedupKey)
 * bloque tout doublon. dedupKey = `user-<id>:<YYYYMMDD>`.
 *
 * L'appelant DOIT avoir bindé le tenant via `tenantALS.run(tenantId, …)`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getInactiveClientConfig } from "@/lib/email-marketing/scenarios";
import { getTenantBaseUrl } from "@/lib/email-marketing/tenant-domain";
import { isUnsubscribed } from "@/lib/email-marketing/unsubscribe";
import { encodeUnsubscribeToken, encodeTrackingToken } from "@/lib/email-marketing/tokens";
import { renderInactiveClientEmail } from "@/lib/email-marketing/templates/inactive-client";

export interface RunInactiveClientResult {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}

const MAX_PER_TICK = 200;

export async function runInactiveClientScan(
  tenantId: string,
): Promise<RunInactiveClientResult> {
  const result: RunInactiveClientResult = { scanned: 0, sent: 0, skipped: 0, errors: 0 };

  const { enabled, config } = await getInactiveClientConfig(tenantId);
  if (!enabled) return result;

  const now = Date.now();
  const inactiveThreshold = new Date(now - config.inactiveAfterDays * 24 * 60 * 60 * 1000);
  const cooldownSince = new Date(now - config.cooldownDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.user.findMany({
    where: {
      tenantId,
      role: "CLIENT",
      status: "APPROVED",
      email: { not: "" },
      // Doit avoir un lastLoginAt (sinon jamais connecté = pas notre cible)
      lastLoginAt: { not: null, lt: inactiveThreshold },
      // Et la dernière activité (lastSeenAt) doit aussi être ancienne — évite
      // les faux positifs (user connecté hier mais lastLoginAt ancien).
      OR: [
        { lastSeenAt: null },
        { lastSeenAt: { lt: inactiveThreshold } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastLoginAt: true,
      lastSeenAt: true,
    },
    take: MAX_PER_TICK,
  });

  result.scanned = candidates.length;

  const shopName = await getTenantShopName(tenantId);

  for (const user of candidates) {
    try {
      const email = user.email?.trim();
      if (!email) {
        result.skipped += 1;
        continue;
      }

      // Cooldown : déjà relancé cet user dans la fenêtre ?
      const recent = await prisma.emailSend.findFirst({
        where: {
          tenantId,
          scenarioKey: "INACTIVE_CLIENT",
          userId: user.id,
          sentAt: { gte: cooldownSince },
        },
        select: { id: true },
      });
      if (recent) {
        result.skipped += 1;
        continue;
      }

      if (await isUnsubscribed(tenantId, email, "INACTIVE_REMINDERS")) {
        result.skipped += 1;
        continue;
      }

      const lastActivity = mostRecent(user.lastLoginAt, user.lastSeenAt);
      if (!lastActivity) {
        result.skipped += 1;
        continue;
      }
      const daysSince = Math.max(
        1,
        Math.floor((now - lastActivity.getTime()) / (24 * 60 * 60 * 1000)),
      );

      const ok = await sendInactiveClientEmailInternal({
        tenantId,
        shopName,
        userId: user.id,
        email,
        firstName: user.firstName ?? "",
        daysSince,
      });
      if (ok) result.sent += 1;
      else result.errors += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("[InactiveClient] Échec traitement", {
        tenantId,
        userId: user.id,
        error: err as Error,
      });
    }
  }

  return result;
}

/**
 * Envoi manuel pour un user précis (appelé depuis la page /admin/utilisateurs).
 * Utilise le même pipeline que le scan auto — même template, même dédup,
 * mêmes garde-fous unsubscribe.
 *
 * `dedupKey` externalisé pour que l'appelant puisse imposer un rate-limit
 * personnalisé (ex. `manual:<userId>:<YYYYMMDD>` = max 1 relance/jour).
 */
export async function sendInactiveClientEmail(params: {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  daysSinceLastLogin: number;
  dedupKey: string;
  scenarioKey?: "INACTIVE_CLIENT" | "MANUAL_RELANCE";
}): Promise<boolean> {
  const shopName = await getTenantShopName(params.tenantId);
  return sendInactiveClientEmailInternal({
    tenantId: params.tenantId,
    shopName,
    userId: params.userId,
    email: params.email,
    firstName: params.firstName,
    daysSince: params.daysSinceLastLogin,
    overrideDedupKey: params.dedupKey,
    overrideScenarioKey: params.scenarioKey,
  });
}

async function sendInactiveClientEmailInternal(params: {
  tenantId: string;
  shopName: string;
  userId: string;
  email: string;
  firstName: string;
  daysSince: number;
  overrideDedupKey?: string;
  overrideScenarioKey?: "INACTIVE_CLIENT" | "MANUAL_RELANCE";
}): Promise<boolean> {
  const scenarioKey = params.overrideScenarioKey ?? "INACTIVE_CLIENT";
  const baseUrl = await getTenantBaseUrl(params.tenantId);
  const dateStamp = ymd(new Date());
  const dedupKey = params.overrideDedupKey ?? `user-${params.userId}:${dateStamp}`;

  const unsubToken = encodeUnsubscribeToken(
    params.tenantId,
    params.email,
    "INACTIVE_REMINDERS",
  );
  const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;
  const catalogUrl = `${baseUrl}/fr/produits`;
  const companyLegal = await getCompanyLegalLine(params.tenantId);

  let sendRow;
  try {
    sendRow = await prisma.emailSend.create({
      data: {
        tenantId: params.tenantId,
        scenarioKey,
        recipientEmail: params.email.toLowerCase().trim(),
        userId: params.userId,
        subject: "",
        dedupKey,
        metadata: {
          daysSince: params.daysSince,
          source: params.overrideDedupKey ? "manual" : "auto",
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (err) {
    // Contrainte unique déjà satisfaite = déjà envoyé (idem que abandoned-cart).
    logger.warn("[InactiveClient] EmailSend déjà présent — skip", {
      tenantId: params.tenantId,
      dedupKey,
      error: (err as Error).message,
    });
    return false;
  }

  const pixelToken = encodeTrackingToken(sendRow.id);
  const pixelUrl = `${baseUrl}/api/emails/track/pixel?t=${encodeURIComponent(pixelToken)}`;

  const { subject, html } = renderInactiveClientEmail({
    customerFirstName: params.firstName,
    shopName: params.shopName,
    daysSinceLastLogin: params.daysSince,
    catalogUrl,
    unsubscribeUrl,
    pixelUrl,
    companyLegal,
  });

  const result = await sendMail({ to: params.email, subject, html });

  if (result.sent) {
    await prisma.emailSend.update({
      where: { id: sendRow.id },
      data: { subject, messageId: result.id || null },
    });
    return true;
  }

  await prisma.emailSend.update({
    where: { id: sendRow.id },
    data: { subject: `[ÉCHEC SMTP] ${subject}` },
  });
  logger.error("[InactiveClient] Échec SMTP", {
    tenantId: params.tenantId,
    to: params.email,
    reason: result.sent === false ? result.reason : "unknown",
  });
  return false;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mostRecent(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a > b ? a : b;
  return a ?? b ?? null;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function getTenantShopName(tenantId: string): Promise<string> {
  const info = await prisma.companyInfo.findFirst({
    where: { tenantId },
    select: { shopName: true, name: true },
  });
  const name = info?.shopName?.trim() || info?.name?.trim();
  if (name) return name;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  return tenant?.name ?? "notre boutique";
}

async function getCompanyLegalLine(tenantId: string): Promise<string> {
  try {
    const info = await prisma.companyInfo.findFirst({
      where: { tenantId },
      select: {
        shopName: true,
        name: true,
        address: true,
        postalCode: true,
        city: true,
      },
    });
    if (!info) return "";
    const displayName = info.shopName?.trim() || info.name?.trim();
    const addressLine = [
      info.address,
      [info.postalCode, info.city].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");
    return [displayName, addressLine].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}
