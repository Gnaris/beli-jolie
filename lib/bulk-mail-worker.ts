/**
 * lib/bulk-mail-worker.ts
 *
 * File d'envoi groupé de newsletter aux fiches clients (AdminClientCard).
 * Alimente le widget « Envoi de mails » du rail admin.
 *
 * Flux :
 *   1. `enqueueBulkMailJob` crée un `BulkMailJob` PENDING avec la liste des
 *      destinataires (fiche + email), état initial `WAITING`.
 *   2. Ce worker singleton poll toutes les 1s les jobs PENDING, les passe à
 *      RUNNING, envoie séquentiellement avec 300 ms de délai (anti-spam ISP),
 *      met à jour chaque destinataire au fil (SENDING → SENT/FAILED).
 *   3. Widget UI poll `/api/admin/bulk-mail-jobs` toutes les 2 s pour l'affichage
 *      temps réel ligne par ligne.
 *
 * Rythme d'envoi : 300 ms entre chaque mail = ~3.3 mails/s = ~200 mails/min.
 * Assez lent pour ne pas déclencher les heuristiques anti-spam Gmail/Outlook
 * (burst > 20 mails/s = suspicion), assez rapide pour un lot de 200 clients
 * en ~1 min. Constante `INTER_MAIL_DELAY_MS` réglable ici si besoin.
 *
 * Résilience : au boot, sweep RUNNING → PENDING (worker crash à mi-parcours ;
 * on recommence le job mais les destinataires déjà SENT ne sont pas ré-envoyés,
 * le worker itère uniquement sur ceux en `WAITING` ou `SENDING`).
 */

import { Prisma, type BulkMailJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/email";
import { getCurrentTenantBaseUrl } from "@/lib/tenant-url";
import { getCachedShopName } from "@/lib/cached-data";
import {
  renderNewsletterHtml,
  substituteVariables,
  type ProductLite,
  type NewsletterBlock,
} from "@/lib/newsletter-blocks";
import { interpolate, type MailMergeContext } from "@/lib/mail-merge-variables";

// ─────────────────────────────────────────────
// Constantes réglables
// ─────────────────────────────────────────────

/**
 * Délai entre 2 envois. 2500 ms = ~24 mails/min, soit ~1440 mails/h.
 *
 * Cadence choisie pour la réputation d'une IP fixe VPS Hostinger émettant en
 * son nom (contact@beliandjolie.com, DKIM/SPF/DMARC posés) sans historique
 * de masse. Gmail commence à throttler (421 4.7.0) au-delà de ~500 mails/h
 * depuis une IP à faible réputation ; Outlook durcit vers ~300/h. À 2,5 s
 * d'écart, un burst de 500 destinataires s'étale sur ~20 min — signal
 * comportemental « CRM légitime » plutôt que « burst spam ».
 *
 * Cas d'usage prévus : lots de 50 à 500 fiches. Au-delà de 1000, fractionner
 * par ISP destinataire (Gmail/Outlook/Free) avec pause inter-lots — non
 * implémenté (à ajouter le jour où la cliente a des lots > 1000).
 */
const INTER_MAIL_DELAY_MS = 2_500;

/** Fréquence du poll worker. 1 s reste réactif sans surcharger MySQL. */
const POLL_MS = 1_000;

/** Fenêtre pendant laquelle un job DONE/FAILED reste visible dans le widget. */
export const RECENT_DONE_LIMIT_MS = 5 * 60_000;

const STARTUP_GUARD = Symbol.for("beliandjolie.bulkMailWorker.started");
const g = globalThis as Record<symbol, unknown>;

// ─────────────────────────────────────────────
// Types du payload `recipients` (persisté en JSON)
// ─────────────────────────────────────────────

export type BulkMailRecipientStatus = "WAITING" | "SENDING" | "SENT" | "FAILED";

export interface BulkMailRecipient {
  ficheId: string;
  email: string;
  /** Libellé affiché dans le widget (ex: "Marie Dupont · Bijoux Marie"). */
  name: string;
  status: BulkMailRecipientStatus;
  /** ISO 8601. Rempli quand SENT ou FAILED. */
  attemptedAt?: string;
  /** Message d'erreur si FAILED (raison SMTP simplifiée). */
  error?: string;
}

// ─────────────────────────────────────────────
// API publique — enqueue + list + dismiss
// ─────────────────────────────────────────────

export interface EnqueueBulkMailInput {
  tenantId: string;
  templateId: string;
  templateName: string;
  templateSubject: string;
  recipients: Array<{ ficheId: string; email: string; name: string }>;
}

export async function enqueueBulkMailJob(
  input: EnqueueBulkMailInput,
): Promise<{ jobId: string }> {
  const recipients: BulkMailRecipient[] = input.recipients.map((r) => ({
    ficheId: r.ficheId,
    email: r.email,
    name: r.name,
    status: "WAITING",
  }));

  const job = await prisma.bulkMailJob.create({
    data: {
      tenantId: input.tenantId,
      templateId: input.templateId,
      templateName: input.templateName,
      templateSubject: input.templateSubject,
      recipients: recipients as unknown as Prisma.InputJsonValue,
      totalCount: recipients.length,
    },
    select: { id: true },
  });

  // Kick immédiat pour ne pas attendre le prochain poll (jusqu'à 1 s d'attente
  // sinon). setImmediate évite la course avec la fin de la transaction courante.
  setImmediate(() => {
    void tickIfIdle();
  });

  return { jobId: job.id };
}

/**
 * Jobs visibles dans le widget : actifs OU récemment terminés (5 min) et non
 * dismissed. Scopé automatiquement au tenant courant via l'extension Prisma.
 */
export async function listRecentBulkMailJobs() {
  const cutoff = new Date(Date.now() - RECENT_DONE_LIMIT_MS);
  return prisma.bulkMailJob.findMany({
    where: {
      OR: [
        { status: { in: ["PENDING", "RUNNING"] } },
        {
          status: { in: ["COMPLETED", "FAILED"] },
          dismissedAt: null,
          completedAt: { gte: cutoff },
        },
      ],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 20,
  });
}

/** Cache un job du widget (soft delete) — bouton croix de la ligne. */
export async function dismissBulkMailJob(id: string): Promise<void> {
  await prisma.bulkMailJob
    .update({ where: { id }, data: { dismissedAt: new Date() } })
    .catch(() => {});
}

// ─────────────────────────────────────────────
// Worker singleton
// ─────────────────────────────────────────────

let running = false;

/** Démarre le worker (idempotent — safe à ré-appeler). */
export function startBulkMailWorker(): void {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;

  // Sweep RUNNING orphelins au boot (crash à mi-parcours). Les destinataires
  // déjà SENT restent SENT — le worker ne les retente pas.
  // Bypass scoping tenant : le boot n'a pas de tenant courant, on scope explicite
  // via `MULTI_TENANT_SCOPE=off` inutile ici car pas de headers → extension
  // laisse passer par défaut. On utilise updateMany direct.
  prisma.bulkMailJob
    .updateMany({
      where: { status: "RUNNING" },
      data: { status: "PENDING" },
    })
    .then((res) => {
      if (res.count > 0) {
        logger.info(`[BulkMail] ${res.count} job(s) RUNNING remis en PENDING au boot`);
      }
    })
    .catch((err) => {
      logger.warn("[BulkMail] Sweep RUNNING au boot échoué", { error: err });
    });

  const tick = () => {
    void tickIfIdle().finally(() => {
      setTimeout(tick, POLL_MS);
    });
  };
  tick();

  logger.info("[BulkMail] Worker démarré");
}

/** Traite le prochain job PENDING si aucun n'est déjà en cours. */
async function tickIfIdle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = await prisma.bulkMailJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return;
    await processJob(job.id);
  } catch (err) {
    logger.error("[BulkMail] Erreur de tick", { error: err as Error });
  } finally {
    running = false;
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = await prisma.bulkMailJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" as BulkMailJobStatus, startedAt: new Date() },
  });

  // Multi-tenant : wrap tout le corps dans tenantALS pour que les caches
  // scopés (SMTP config, shop name, base URL) résolvent le bon tenant.
  const { tenantALS } = await import("@/lib/tenant-als");
  await tenantALS.run(job.tenantId, () => processJobBody(job.id));
}

async function processJobBody(jobId: string): Promise<void> {
  // Recharge dans le contexte ALS pour bénéficier du scope tenant.
  const job = await prisma.bulkMailJob.findFirst({ where: { id: jobId } });
  if (!job) return;

  const recipients = (Array.isArray(job.recipients)
    ? (job.recipients as unknown as BulkMailRecipient[])
    : []);

  // Charge le modèle newsletter (peut avoir été supprimé — dans ce cas, fail
  // le job avec une erreur globale).
  let template: {
    id: string;
    name: string;
    subject: string;
    blocks: unknown;
  } | null = null;
  if (job.templateId) {
    template = await prisma.newsletterTemplate.findFirst({
      where: { id: job.templateId },
      select: { id: true, name: true, subject: true, blocks: true },
    });
  }
  if (!template) {
    await failJob(job.id, "Modèle newsletter introuvable ou supprimé.");
    return;
  }

  const blocks = Array.isArray(template.blocks) ? (template.blocks as NewsletterBlock[]) : [];

  // Contexte partagé boutique (mêmes règles que sendNewsletterToUsers)
  const [shopName, baseUrl, companyInfo, legalLine, productsById] = await Promise.all([
    getCachedShopName(),
    getCurrentTenantBaseUrl(),
    prisma.companyInfo.findFirst({
      select: { address: true, postalCode: true, city: true, email: true, phone: true, website: true },
    }),
    buildLegalLine(),
    loadProductsForBlocks(blocks),
  ]);

  const computedShopAddress = companyInfo
    ? [companyInfo.address, [companyInfo.postalCode, companyInfo.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";
  if (!shopName.trim() || !computedShopAddress.trim()) {
    await failJob(
      job.id,
      "Nom de boutique ou adresse manquant dans les infos entreprise. " +
        "Complète Paramètres → Boutique avant d'envoyer un mail marketing.",
    );
    return;
  }
  const shopEmail = companyInfo?.email ?? "";
  const unsubscribeLink = shopEmail
    ? `mailto:${shopEmail}?subject=${encodeURIComponent("Désinscription newsletter")}`
    : `${baseUrl}/fr/contact`;
  const shopContext: MailMergeContext = {
    shopName,
    shopAddress: computedShopAddress,
    shopEmail,
    shopPhone: companyInfo?.phone ?? "",
    shopWebsite: companyInfo?.website ?? baseUrl.replace(/^https?:\/\//, ""),
  };

  let sentCount = 0;
  let failedCount = 0;
  let smtpBrokeDown = false;

  for (let i = 0; i < recipients.length; i++) {
    const rcp = recipients[i];
    // Skip ceux déjà traités (reprise après sweep RUNNING → PENDING).
    if (rcp.status === "SENT" || rcp.status === "FAILED") {
      if (rcp.status === "SENT") sentCount++;
      else failedCount++;
      continue;
    }

    // Marque SENDING en BDD pour affichage temps réel côté widget.
    recipients[i] = { ...rcp, status: "SENDING" };
    await persistRecipients(job.id, recipients, sentCount, failedCount);

    // Charge les infos fiche pour interpolation par destinataire
    const fiche = await prisma.adminClientCard.findFirst({
      where: { id: rcp.ficheId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        email: true,
        phone: true,
        siret: true,
        vatNumber: true,
        addressLine: true,
        postalCode: true,
        city: true,
        countryCode: true,
      },
    });

    if (!fiche || !fiche.email || fiche.email.trim().length === 0) {
      recipients[i] = {
        ...recipients[i],
        status: "FAILED",
        attemptedAt: new Date().toISOString(),
        error: "Fiche introuvable ou email vide au moment de l'envoi.",
      };
      failedCount++;
      await persistRecipients(job.id, recipients, sentCount, failedCount);
      continue;
    }

    const ficheContext: MailMergeContext = {
      ...shopContext,
      firstName: fiche.firstName,
      lastName: fiche.lastName,
      fullName: `${fiche.firstName} ${fiche.lastName}`.trim(),
      email: fiche.email,
      company: fiche.company ?? "",
      phone: fiche.phone ?? "",
      siret: fiche.siret ?? "",
      tvaIntra: fiche.vatNumber ?? "",
      address: fiche.addressLine ?? "",
      postalCode: fiche.postalCode ?? "",
      city: fiche.city ?? "",
      country: fiche.countryCode ?? "",
      unsubscribeLink,
      privacyLink: `${baseUrl}/fr/confidentialite`,
    };

    const interpolatedBlocks = substituteVariables(blocks, ficheContext);
    const interpolatedSubject = interpolate(template.subject, ficheContext);
    const html = renderNewsletterHtml({
      subject: interpolatedSubject,
      blocks: interpolatedBlocks,
      productsById,
      omitGlobalChrome: true,
      shared: { shopName, baseUrl, legalLine, mergeContext: ficheContext },
    });

    const result = await sendMail({
      to: fiche.email,
      subject: interpolatedSubject,
      html,
      fromName: shopName,
      // Fiche prospect : pas de token unique (userId=null), on retombe sur
      // le mailto: de désinscription construit ligne 285. Accepté par
      // sendMail comme List-Unsubscribe RFC 2369 (sans One-Click).
      listUnsubscribeUrl: unsubscribeLink,
      tracking: {
        scenarioKey: "NEWSLETTER",
        userId: null,
        metadata: {
          templateId: template.id,
          templateName: template.name,
          ficheId: fiche.id,
          bulkMailJobId: job.id,
          recipientKind: "fiche",
        },
      },
    });

    if (result.sent) {
      recipients[i] = {
        ...recipients[i],
        status: "SENT",
        attemptedAt: new Date().toISOString(),
      };
      sentCount++;
      // Marque la fiche pour l'affichage « Dernier mail envoyé »
      await prisma.adminClientCard
        .update({
          where: { id: fiche.id },
          data: { lastMessageSentAt: new Date() },
        })
        .catch((err) => {
          logger.warn("[BulkMail] update fiche lastMessageSentAt échoué", {
            ficheId: fiche.id,
            error: err as Error,
          });
        });
    } else {
      const reason =
        result.reason === "no_config"
          ? "Configuration SMTP absente."
          : result.reason === "no_from"
            ? "Adresse expéditeur non configurée."
            : `Refusé (${result.error ?? "raison inconnue"}).`;
      recipients[i] = {
        ...recipients[i],
        status: "FAILED",
        attemptedAt: new Date().toISOString(),
        error: reason,
      };
      failedCount++;
      // no_config / no_from → global, on ne bombarde pas tous les mails ensuite.
      if (result.reason === "no_config" || result.reason === "no_from") {
        smtpBrokeDown = true;
      }
    }

    await persistRecipients(job.id, recipients, sentCount, failedCount);

    if (smtpBrokeDown) {
      // Marque tous les restants comme FAILED — pas d'espoir d'envoyer les suivants.
      for (let j = i + 1; j < recipients.length; j++) {
        if (recipients[j].status === "WAITING") {
          recipients[j] = {
            ...recipients[j],
            status: "FAILED",
            attemptedAt: new Date().toISOString(),
            error: "Envoi stoppé — SMTP indisponible.",
          };
          failedCount++;
        }
      }
      await persistRecipients(job.id, recipients, sentCount, failedCount);
      break;
    }

    if (INTER_MAIL_DELAY_MS > 0) await new Promise((r) => setTimeout(r, INTER_MAIL_DELAY_MS));
  }

  // Update modèle lastSentAt si au moins 1 envoyé
  if (sentCount > 0 && job.templateId) {
    await prisma.newsletterTemplate
      .update({ where: { id: job.templateId }, data: { lastSentAt: new Date() } })
      .catch(() => {});
  }

  await prisma.bulkMailJob.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED" as BulkMailJobStatus,
      completedAt: new Date(),
      sentCount,
      failedCount,
      recipients: recipients as unknown as Prisma.InputJsonValue,
    },
  });
}

async function persistRecipients(
  jobId: string,
  recipients: BulkMailRecipient[],
  sentCount: number,
  failedCount: number,
): Promise<void> {
  await prisma.bulkMailJob.update({
    where: { id: jobId },
    data: {
      recipients: recipients as unknown as Prisma.InputJsonValue,
      sentCount,
      failedCount,
    },
  });
}

async function failJob(jobId: string, message: string): Promise<void> {
  await prisma.bulkMailJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED" as BulkMailJobStatus,
      completedAt: new Date(),
      errorMessage: message,
    },
  });
}

// ─────────────────────────────────────────────
// Helpers partagés avec send-newsletter-fiches
// ─────────────────────────────────────────────

async function loadProductsForBlocks(
  blocks: NewsletterBlock[],
): Promise<Map<string, ProductLite>> {
  const productIds = blocks
    .filter((b): b is Extract<NewsletterBlock, { type: "products" }> => b.type === "products")
    .flatMap((b) => b.data.productIds);
  const uniqueProductIds = [...new Set(productIds)];
  const productsById = new Map<string, ProductLite>();
  if (uniqueProductIds.length === 0) return productsById;

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds } },
    select: {
      id: true,
      name: true,
      reference: true,
      colors: {
        take: 1,
        orderBy: { isPrimary: "desc" },
        select: {
          unitPrice: true,
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
      },
    },
  });
  for (const p of products) {
    const v = p.colors[0];
    productsById.set(p.id, {
      id: p.id,
      name: p.name,
      reference: p.reference,
      imagePath: v?.images[0]?.path ?? null,
      priceCents: v ? Math.round(Number(v.unitPrice) * 100) : null,
    });
  }
  return productsById;
}

async function buildLegalLine(): Promise<string> {
  try {
    const info = await prisma.companyInfo.findFirst({
      select: { shopName: true, name: true, address: true, postalCode: true, city: true },
    });
    if (!info) return "";
    const displayName = info.shopName?.trim() || info.name?.trim();
    const addressLine = [info.address, [info.postalCode, info.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    return [displayName, addressLine].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}
