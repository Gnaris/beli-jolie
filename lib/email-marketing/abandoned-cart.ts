/**
 * lib/email-marketing/abandoned-cart.ts
 *
 * Scanne les paniers abandonnés du tenant courant et envoie les relances
 * configurées (par défaut 24 h + 72 h — configurable dans l'admin).
 *
 * Règles de détection :
 *   - Panier avec au moins un item.
 *   - `Cart.updatedAt < now - stage.afterHours` (le panier n'a plus bougé
 *     depuis N heures).
 *   - Utilisateur `APPROVED` (client qui voit les prix), email non vide.
 *   - Pas de désabonnement CART_REMINDERS ni MARKETING_ALL pour cet email.
 *   - Aucune ligne EmailSend existante avec le même dedupKey
 *     (`cart:<userId>:cart-<cartId>:stage-<index>`) — insertion en unique
 *     tenantId+scenarioKey+dedupKey qui rend l'idempotence stricte.
 *
 * L'envoi utilise `lib/email.ts::sendMail` (SMTP par tenant, config chiffrée).
 * L'appelant DOIT avoir bindé le tenant via `tenantALS.run(tenantId, …)`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getAbandonedCartConfig } from "@/lib/email-marketing/scenarios";
import { getTenantBaseUrl } from "@/lib/email-marketing/tenant-domain";
import { isUnsubscribed } from "@/lib/email-marketing/unsubscribe";
import { encodeUnsubscribeToken, encodeTrackingToken } from "@/lib/email-marketing/tokens";
import {
  renderAbandonedCartEmail,
  type AbandonedCartItemView,
} from "@/lib/email-marketing/templates/abandoned-cart";

export interface RunAbandonedCartResult {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}

/**
 * Exécute une passe de détection + envoi pour un tenant donné.
 * Idempotent : ré-exécuter la fonction ne renvoie jamais 2× le même email.
 */
export async function runAbandonedCartScan(
  tenantId: string,
): Promise<RunAbandonedCartResult> {
  const result: RunAbandonedCartResult = { scanned: 0, sent: 0, skipped: 0, errors: 0 };

  const { enabled, config } = await getAbandonedCartConfig(tenantId);
  if (!enabled) return result;
  if (config.reminders.length === 0) return result;

  const now = Date.now();

  // On traite chaque stage (relance 0 = 24h, 1 = 72h, …) séquentiellement.
  // La fenêtre pour un stage donné est bornée : entre now-afterHours et
  // now-afterHours-24h — au-delà, on considère que la fenêtre est passée.
  for (let stageIndex = 0; stageIndex < config.reminders.length; stageIndex += 1) {
    const stage = config.reminders[stageIndex];
    const upperBound = new Date(now - stage.afterHours * 60 * 60 * 1000);
    // Fenêtre : on remonte jusqu'à 7 jours en arrière pour rattraper les
    // paniers qui ont légitimement dépassé le seuil pendant un downtime.
    const lowerBound = new Date(now - (stage.afterHours + 7 * 24) * 60 * 60 * 1000);

    const carts = await prisma.cart.findMany({
      where: {
        tenantId,
        updatedAt: { gte: lowerBound, lt: upperBound },
        items: { some: {} },
        user: { status: "APPROVED" },
      },
      select: {
        id: true,
        userId: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
            firstName: true,
          },
        },
        items: {
          select: {
            quantity: true,
            variant: {
              select: {
                id: true,
                unitPrice: true,
                packQuantity: true,
                saleType: true,
                product: {
                  select: { id: true, name: true, reference: true },
                },
                color: {
                  select: { name: true },
                },
                images: {
                  orderBy: { order: "asc" },
                  take: 1,
                  select: { path: true },
                },
              },
            },
          },
        },
      },
      take: 200,
    });

    result.scanned += carts.length;

    for (const cart of carts) {
      try {
        const email = cart.user?.email?.trim();
        if (!email) {
          result.skipped += 1;
          continue;
        }
        if (cart.items.length === 0) {
          result.skipped += 1;
          continue;
        }

        const dedupKey = `cart-${cart.id}:stage-${stageIndex}`;
        // Si un email a déjà été envoyé pour ce (cart, stage), skip.
        const already = await prisma.emailSend.findUnique({
          where: {
            tenantId_scenarioKey_dedupKey: {
              tenantId,
              scenarioKey: "ABANDONED_CART",
              dedupKey,
            },
          },
          select: { id: true },
        });
        if (already) {
          result.skipped += 1;
          continue;
        }

        // Respect désabonnement.
        if (await isUnsubscribed(tenantId, email, "CART_REMINDERS")) {
          result.skipped += 1;
          continue;
        }

        const sent = await sendAbandonedCartEmail({
          tenantId,
          stageIndex,
          cart,
          email,
          firstName: cart.user?.firstName ?? "",
          dedupKey,
        });
        if (sent) result.sent += 1;
        else result.errors += 1;
      } catch (err) {
        result.errors += 1;
        logger.error("[AbandonedCart] Échec traitement panier", {
          tenantId,
          cartId: cart.id,
          stageIndex,
          error: err as Error,
        });
      }
    }
  }

  return result;
}

interface CartQueryRow {
  id: string;
  userId: string;
  items: Array<{
    quantity: number;
    variant: {
      id: string;
      unitPrice: Prisma.Decimal;
      packQuantity: number | null;
      saleType: "UNIT" | "PACK";
      product: { id: string; name: string; reference: string };
      color: { name: string } | null;
      images: Array<{ path: string }>;
    };
  }>;
}

interface SendParams {
  tenantId: string;
  stageIndex: number;
  cart: CartQueryRow;
  email: string;
  firstName: string;
  dedupKey: string;
}

async function sendAbandonedCartEmail(params: SendParams): Promise<boolean> {
  const baseUrl = await getTenantBaseUrl(params.tenantId);

  const items: AbandonedCartItemView[] = params.cart.items.map((line) => {
    const totalUnitPrice = Number(line.variant.unitPrice);
    const lineTotal = totalUnitPrice * line.quantity;
    const imagePath = line.variant.images[0]?.path;
    return {
      productName: line.variant.product.name,
      reference: line.variant.product.reference,
      colorName: line.variant.color?.name ?? null,
      quantity: line.quantity,
      linePriceLabel: formatEuros(lineTotal),
      imageUrl: imagePath ? absoluteUrl(baseUrl, imagePath) : null,
      fallbackInitial: (line.variant.product.name?.[0] ?? "•").toUpperCase(),
    };
  });

  const totalCents = params.cart.items.reduce((sum, l) => {
    return sum + Math.round(Number(l.variant.unitPrice) * 100) * l.quantity;
  }, 0);
  const totalLabel = formatEuros(totalCents / 100);
  const itemCount = params.cart.items.reduce((sum, l) => sum + l.quantity, 0);

  const unsubToken = encodeUnsubscribeToken(params.tenantId, params.email, "CART_REMINDERS");
  const unsubscribeUrl = `${baseUrl}/desabonnement?token=${encodeURIComponent(unsubToken)}`;
  const resumeUrl = `${baseUrl}/panier`;
  const companyLegal = await getCompanyLegalLine(params.tenantId);

  // On crée EmailSend AVANT envoi pour bloquer les doublons (contrainte unique
  // sur tenantId+scenarioKey+dedupKey). Si l'envoi échoue, on met à jour un
  // marqueur ; sinon, on met à jour messageId.
  let sendRow;
  try {
    sendRow = await prisma.emailSend.create({
      data: {
        tenantId: params.tenantId,
        scenarioKey: "ABANDONED_CART",
        recipientEmail: params.email.toLowerCase().trim(),
        userId: params.cart.userId,
        subject: "", // sera mis à jour juste après (on connaît le stage)
        dedupKey: params.dedupKey,
        metadata: {
          cartId: params.cart.id,
          stage: params.stageIndex,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (err) {
    // Race condition possible (2 workers). Le seul cas normal est la
    // contrainte unique déjà satisfaite = un autre process vient d'envoyer.
    logger.warn("[AbandonedCart] EmailSend déjà présent (race) — skip", {
      tenantId: params.tenantId,
      dedupKey: params.dedupKey,
      error: (err as Error).message,
    });
    return false;
  }

  const pixelToken = encodeTrackingToken(sendRow.id);
  const pixelUrl = `${baseUrl}/api/emails/track/pixel?t=${encodeURIComponent(pixelToken)}`;

  const { subject, html } = renderAbandonedCartEmail({
    customerFirstName: params.firstName || "",
    items,
    totalLabel,
    itemCount,
    resumeUrl,
    unsubscribeUrl,
    pixelUrl,
    companyLegal,
    reminderIndex: params.stageIndex,
  });

  const result = await sendMail({ to: params.email, subject, html });

  if (result.sent) {
    await prisma.emailSend.update({
      where: { id: sendRow.id },
      data: { subject, messageId: result.id || null },
    });
    return true;
  }

  // Envoi échoué : on garde la ligne EmailSend pour ne pas retenter en boucle,
  // mais on marque le sujet en erreur pour visibilité admin.
  await prisma.emailSend.update({
    where: { id: sendRow.id },
    data: {
      subject: `[ÉCHEC SMTP] ${subject}`,
    },
  });
  logger.error("[AbandonedCart] Échec SMTP", {
    tenantId: params.tenantId,
    to: params.email,
    reason: result.sent === false ? result.reason : "unknown",
  });
  return false;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatEuros(amount: number): string {
  return amount.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function absoluteUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

/**
 * Renvoie une ligne de mentions légales — "Nom · Adresse". Cherche dans
 * CompanyInfo du tenant. Fallback minimal si aucune donnée.
 */
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
