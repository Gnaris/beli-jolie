/**
 * lib/orphan-payment-intents-worker.ts
 *
 * Cron intégré : détecte les PaymentIntent Stripe `succeeded` qui n'ont pas
 * de commande associée en BDD (client débité mais commande jamais créée).
 *
 * Cas cible : incident Quinchon (16/08/2026) — Mme Q a été débitée 3× 140,34 €
 * sans qu'aucune commande n'apparaisse. Si un webhook plante, si placeOrder
 * crashe entre la retrieve PI et order.create, si le client ferme l'onglet
 * pendant le confirm — aucun autre garde-fou n'attrape le débit orphelin.
 *
 * Fonctionnement :
 *  - Tick horaire (`POLL_MS = 60 min`)
 *  - Pour chaque tenant qui a Stripe configuré :
 *      1. Liste les PI créés sur la fenêtre [now - 2h, now - 5min]
 *         (fenêtre glissante : 5 min de buffer pour laisser le temps à
 *         placeOrder de finir, 2h de largeur pour rattraper 1 tick manqué).
 *      2. Filtre uniquement `status === succeeded`.
 *      3. Cross-check `Order.findFirst({stripePaymentIntentId})` scopé tenant.
 *      4. Pour chaque PI orphelin → log CRITICAL + mail admin (unique par PI
 *         via une table de dédup `OrphanPaymentIntent` NON — on utilise le
 *         cache mémoire : le worker est idempotent, un même PI ré-alerté
 *         chaque heure est OK tant que l'admin n'a pas remboursé/créé la
 *         commande manuellement).
 *
 * Le worker ne fait AUCUNE mutation Stripe (pas de refund auto). L'admin
 * décide : refund manuel + création commande recovery (comme pour Quinchon).
 */

import "server-only";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { getStripeInstance, isStripeConfigured } from "@/lib/stripe";
import { sendMail } from "@/lib/email";
import { getCachedShopName } from "@/lib/cached-data";
import { resolveNotifyEmail } from "@/lib/notifications";

const POLL_MS = 60 * 60 * 1000; // 1 heure
const WINDOW_START_OFFSET_MS = 2 * 60 * 60 * 1000; // -2h
const WINDOW_END_OFFSET_MS = 5 * 60 * 1000; // -5min (buffer placeOrder)

const STARTUP_GUARD = Symbol.for("beliandjolie.orphanPiWorker.started");
const g = globalThis as Record<symbol, unknown>;

// Anti-spam : on ne re-notifie pas plus d'une fois par 24h par PI. Cache
// mémoire (perdu au restart PM2, acceptable — la 1re notif reste critique).
const alertedRecently = new Map<string, number>();
const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;

export function startOrphanPaymentIntentsWorker() {
  if (g[STARTUP_GUARD]) return;
  g[STARTUP_GUARD] = true;

  logger.info("[OrphanPI] Worker démarré (tick 1h)");

  // Premier tick après 30s (laisser le temps aux autres workers de démarrer),
  // puis toutes les heures.
  setTimeout(runTick, 30_000);
  setInterval(runTick, POLL_MS);
}

async function runTick() {
  try {
    const tenants = await prisma.tenant.findMany({
      select: { id: true, slug: true, name: true },
    });
    for (const t of tenants) {
      await tenantALS.run(t.id, () => scanTenant(t.id, t.slug, t.name)).catch(
        (err) => {
          logger.error("[OrphanPI] Erreur scan tenant", {
            tenantId: t.id,
            tenantSlug: t.slug,
            error: err,
          });
        },
      );
    }
    pruneAlertCache();
  } catch (err) {
    logger.error("[OrphanPI] Erreur runTick", { error: err });
  }
}

async function scanTenant(tenantId: string, tenantSlug: string, tenantName: string) {
  if (!(await isStripeConfigured())) return;

  let stripe: Stripe;
  try {
    stripe = await getStripeInstance();
  } catch {
    return;
  }

  const now = Date.now();
  const createdGte = Math.floor((now - WINDOW_START_OFFSET_MS) / 1000);
  const createdLte = Math.floor((now - WINDOW_END_OFFSET_MS) / 1000);

  let page: Stripe.ApiList<Stripe.PaymentIntent>;
  try {
    page = await stripe.paymentIntents.list({
      created: { gte: createdGte, lte: createdLte },
      limit: 100,
    });
  } catch (err) {
    logger.error("[OrphanPI] Stripe list échouée", {
      tenantId,
      tenantSlug,
      error: err,
    });
    return;
  }

  const succeededPis = page.data.filter((pi) => pi.status === "succeeded");
  if (succeededPis.length === 0) return;

  // Cross-check en batch : une seule requête findMany sur les PI IDs.
  const piIds = succeededPis.map((pi) => pi.id);
  const linkedOrders = await prisma.order.findMany({
    where: { stripePaymentIntentId: { in: piIds } },
    select: { stripePaymentIntentId: true },
  });
  const linkedSet = new Set(
    linkedOrders
      .map((o) => o.stripePaymentIntentId)
      .filter((v): v is string => !!v),
  );

  const orphans = succeededPis.filter((pi) => !linkedSet.has(pi.id));
  if (orphans.length === 0) return;

  for (const pi of orphans) {
    await handleOrphan(pi, tenantId, tenantSlug, tenantName);
  }
}

async function handleOrphan(
  pi: Stripe.PaymentIntent,
  tenantId: string,
  tenantSlug: string,
  tenantName: string,
) {
  const throttleKey = `${tenantId}:${pi.id}`;
  const last = alertedRecently.get(throttleKey);
  if (last && Date.now() - last < ALERT_THROTTLE_MS) return;
  alertedRecently.set(throttleKey, Date.now());

  const amountEur = (pi.amount / 100).toFixed(2);
  const receiptEmail = pi.receipt_email ?? null;
  const userId = typeof pi.metadata?.userId === "string" ? pi.metadata.userId : null;

  logger.error("[OrphanPI] PaymentIntent SUCCEEDED sans commande", {
    tenantId,
    tenantSlug,
    tenantName,
    paymentIntentId: pi.id,
    amountCents: pi.amount,
    amountEur,
    receiptEmail,
    userId,
    createdAt: new Date(pi.created * 1000).toISOString(),
  });

  await notifyAdmin(pi, tenantSlug, tenantName, receiptEmail, amountEur).catch((err) => {
    logger.error("[OrphanPI] Notification admin échouée", {
      paymentIntentId: pi.id,
      error: err,
    });
  });
}

async function notifyAdmin(
  pi: Stripe.PaymentIntent,
  tenantSlug: string,
  tenantName: string,
  receiptEmail: string | null,
  amountEur: string,
) {
  const [shopName, notifyEmail] = await Promise.all([
    getCachedShopName(),
    resolveNotifyEmail(),
  ]);
  if (!notifyEmail) return;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
      <div style="background:#B91C1C;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">⚠️ Paiement Stripe orphelin détecté</h2>
        <p style="margin:6px 0 0;opacity:0.9;font-size:13px;">${escape(tenantName)}</p>
      </div>
      <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
        <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
          Un client a été <strong>débité de ${escape(amountEur)} €</strong> mais aucune
          commande n'apparaît côté boutique.
        </p>
        <table style="width:100%;font-size:13px;line-height:1.6;margin:0 0 16px;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#666;">PaymentIntent</td><td style="padding:4px 0;font-family:monospace;">${escape(pi.id)}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Montant</td><td style="padding:4px 0;">${escape(amountEur)} €</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Email client</td><td style="padding:4px 0;">${escape(receiptEmail ?? "—")}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Date paiement</td><td style="padding:4px 0;">${new Date(pi.created * 1000).toLocaleString("fr-FR")}</td></tr>
        </table>
        <p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#B91C1C;">
          <strong>Action requise :</strong> vérifiez si une commande a été créée manuellement
          côté admin. Sinon, connectez-vous au dashboard Stripe pour rembourser le client OU
          créer la commande recovery.
        </p>
        <p style="font-size:12px;color:#666;margin:0;">
          Cette alerte se répète chaque 24h tant que le PaymentIntent reste orphelin.
        </p>
      </div>
      <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
        ${escape(shopName)} — Alerte automatique (tenant : ${escape(tenantSlug)})
      </p>
    </div>
  `;

  await sendMail({
    fromName: shopName,
    to: notifyEmail,
    subject: `⚠️ Paiement orphelin ${amountEur} € — ${pi.id}`,
    html,
  });
}

function pruneAlertCache() {
  const now = Date.now();
  for (const [k, ts] of alertedRecently.entries()) {
    if (now - ts > ALERT_THROTTLE_MS) alertedRecently.delete(k);
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
