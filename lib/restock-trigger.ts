/**
 * Trigger de mise à jour du job de notification « retour en stock ».
 *
 * Appelé par `lib/stock.ts::createStockMovement` quand une variante vient de
 * passer de stock 0 → >0 (ou négatif → >0). Non-bloquant : les erreurs
 * internes sont loggées et avalées — on ne casse jamais un mouvement de stock
 * pour un souci de notification marketing.
 *
 * Logique :
 *   1. Vérifie que la variante existe + que son produit est ONLINE
 *      (produits OFFLINE/ARCHIVED/SYNCING : on ne notifie pas).
 *   2. Vérifie le kill switch `restock_automation_enabled` du tenant.
 *   3. Trouve tout l'historique commandes + les favoris portant sur ce produit.
 *   4. Dédoublonne par userId, filtre les clients APPROVED + newsletter + non
 *      opt-out restock.
 *   5. Pour chaque client éligible : upsert `RestockNotificationJob` →
 *      - pas de job existant : CREATE PENDING avec entries=[entrée courante]
 *        et scheduledSendAt = now + 24 h.
 *      - job PENDING : AJOUTE l'entrée dans `entries` (dédoublonnée par
 *        productColorId) SANS redémarrer le compteur — le mail unique part
 *        à la date prévue, regroupant tous les produits accumulés.
 *      - job COMPLETED / CANCELLED : REMET en PENDING avec entries=[entrée],
 *        scheduledSendAt = now + 24 h (nouveau cycle).
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
  RESTOCK_DELAY_SITE_CONFIG_KEY,
  RESTOCK_DEFAULT_DELAY_SECONDS,
} from "@/lib/restock-config";

// Ré-export pour les callers historiques qui importaient depuis ce module.
export {
  RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY,
  RESTOCK_DELAY_SITE_CONFIG_KEY,
  RESTOCK_DEFAULT_DELAY_SECONDS,
  RESTOCK_MIN_DELAY_SECONDS,
  RESTOCK_MAX_DELAY_SECONDS,
} from "@/lib/restock-config";

export interface RestockEntry {
  /** ID du produit (sert à charger la fiche à l'envoi + éviter les doublons). */
  productId: string;
  /** ID de la variante retour en stock. */
  productColorId: string;
  /** Le client a ce produit dans ses favoris. */
  isFavorite: boolean;
  /** Le client a au moins une commande (non annulée) qui contient ce produit. */
  hasOrdered: boolean;
  /** ISO date — pour debug + pouvoir purger les entrées trop anciennes. */
  addedAt: string;
}

/**
 * Point d'entrée principal : à appeler APRÈS un mouvement de stock qui fait
 * passer la variante de 0 → >0. Fire-and-forget (safe à await ou pas).
 *
 * `tenantId` est optionnel : si absent, on le résout depuis `Product.tenantId`.
 * Préférer le passer explicitement pour éviter un round-trip Prisma.
 */
export async function enqueueRestockForProductColor(
  productColorId: string,
  tenantId?: string,
): Promise<void> {
  try {
    const variant = await prisma.productColor.findUnique({
      where: { id: productColorId },
      select: {
        id: true,
        stock: true,
        saleType: true,
        product: {
          select: { id: true, status: true, tenantId: true },
        },
      },
    });
    if (!variant) return;
    if (variant.product.status !== "ONLINE") return;
    if (variant.stock <= 0) return; // Appelé à tort — pas de stock à annoncer.
    // Décision cliente : on ne notifie QUE pour les variantes UNIT. Un PACK
    // (ensemble multi-tailles ou multi-couleurs) peut repasser en stock sans
    // intention d'achat du client — et plusieurs variantes PACK d'un même
    // produit rempliraient le mail de doublons. Les PACKs sont ignorés.
    if (variant.saleType !== "UNIT") return;

    const tid = tenantId ?? variant.product.tenantId;
    if (!tid) return;

    // Kill switch tenant — on bail early sans annuler les jobs existants
    // (la cliente peut vouloir rallumer plus tard sans tout perdre).
    const cfg = await prisma.siteConfig.findFirst({
      where: { tenantId: tid, key: RESTOCK_AUTOMATION_ENABLED_SITE_CONFIG_KEY },
      select: { value: true },
    });
    if (cfg?.value !== "true") return;

    const delaySeconds = await readDelaySeconds(tid);

    const productId = variant.product.id;

    // ── Clients éligibles : favoris + historique commandes ──
    // Favoris portent sur le produit (pas la couleur) → tous les favoris du
    // produit sont concernés dès qu'UNE variante repasse en stock.
    // Pour les commandes : on cherche sur TOUTES les variantes du produit
    // (pas uniquement celle qui vient de rentrer) et on remonte toute la vie
    // du client (validé avec la cliente — pas de filtre « récent »). Les
    // commandes annulées sont exclues (pas de vrai acte d'achat).
    const productVariants = await prisma.productColor.findMany({
      where: { productId },
      select: { id: true },
    });
    const variantIds = productVariants.map((v) => v.id);

    const [favorites, orderItems] = await Promise.all([
      prisma.favorite.findMany({
        where: { productId, tenantId: tid },
        select: { userId: true },
      }),
      variantIds.length === 0
        ? Promise.resolve([] as { order: { userId: string | null } }[])
        : prisma.orderItem.findMany({
            where: {
              productColorId: { in: variantIds },
              order: {
                tenantId: tid,
                status: { not: "CANCELLED" },
              },
            },
            select: { order: { select: { userId: true } } },
          }),
    ]);

    const favoriteUsers = new Set(favorites.map((f) => f.userId));
    const orderedUsers = new Set(
      orderItems
        .map((o) => o.order.userId)
        .filter((id): id is string => Boolean(id)),
    );
    const allUserIds = new Set<string>([...favoriteUsers, ...orderedUsers]);
    if (allUserIds.size === 0) return;

    // Filtre : CLIENT APPROVED, newsletter OK, pas d'opt-out restock.
    const eligibleUsers = await prisma.user.findMany({
      where: {
        id: { in: [...allUserIds] },
        tenantId: tid,
        role: "CLIENT",
        status: "APPROVED",
        acceptsNewsletter: true,
        restockOptOut: false,
      },
      select: { id: true },
    });
    if (eligibleUsers.length === 0) return;

    // ── Upsert d'un job par client ──
    // On traite en séquence pour un diagnostic plus clair (volume typique :
    // quelques dizaines de clients max par produit). Si ça devient un hot
    // path, on paralleliseras avec un batching de 10.
    const now = new Date();
    const scheduledSendAt = new Date(now.getTime() + delaySeconds * 1000);

    for (const user of eligibleUsers) {
      const newEntry: RestockEntry = {
        productId,
        productColorId,
        isFavorite: favoriteUsers.has(user.id),
        hasOrdered: orderedUsers.has(user.id),
        addedAt: now.toISOString(),
      };

      try {
        const existing = await prisma.restockNotificationJob.findFirst({
          where: { userId: user.id, tenantId: tid },
          select: {
            id: true,
            status: true,
            entries: true,
            scheduledSendAt: true,
          },
        });

        if (!existing) {
          await prisma.restockNotificationJob.create({
            data: {
              tenantId: tid,
              userId: user.id,
              status: "PENDING",
              entries: [newEntry] as unknown as object,
              scheduledSendAt,
              lastEvaluatedAt: now,
            },
          });
          continue;
        }

        if (existing.status === "PENDING") {
          // Empile sans redémarrer le compteur. Si le produit était déjà
          // dans la file, on merge les flags (hasOrdered + isFavorite ne
          // peuvent que grandir).
          const merged = mergeEntries(parseEntries(existing.entries), newEntry);
          await prisma.restockNotificationJob.update({
            where: { id: existing.id },
            data: {
              entries: merged as unknown as object,
              lastEvaluatedAt: now,
            },
          });
          continue;
        }

        // COMPLETED ou CANCELLED → nouveau cycle propre.
        await prisma.restockNotificationJob.update({
          where: { id: existing.id },
          data: {
            status: "PENDING",
            entries: [newEntry] as unknown as object,
            scheduledSendAt,
            lastEvaluatedAt: now,
            lastSentAt: existing.status === "COMPLETED" ? undefined : null,
            cancelReason: null,
          },
        });
      } catch (err) {
        logger.error("[restock] upsert job failed", {
          tenantId: tid,
          userId: user.id,
          productColorId,
          error: err as Error,
        });
      }
    }
  } catch (err) {
    logger.error("[restock] enqueue failed", {
      productColorId,
      tenantId: tenantId ?? null,
      error: err as Error,
    });
  }
}

/**
 * Retire les entries pointant sur `productColorId` de tous les jobs PENDING
 * du tenant. À appeler quand une variante repasse de stock > 0 → ≤ 0 (ou que
 * le produit sort de ONLINE) — on évite de notifier un retour en stock pour
 * un produit déjà re-rupté avant même l'envoi.
 *
 * Si après retrait le job n'a plus aucune entry, il est marqué CANCELLED
 * (plus rien à annoncer). Non-bloquant : erreurs loggées, pas de throw.
 */
export async function dropRestockEntryForProductColor(
  productColorId: string,
  tenantId?: string,
): Promise<void> {
  try {
    const variant = tenantId
      ? null
      : await prisma.productColor.findUnique({
          where: { id: productColorId },
          select: { product: { select: { tenantId: true } } },
        });
    const tid = tenantId ?? variant?.product.tenantId ?? null;
    if (!tid) return;

    const now = new Date();
    const pending = await prisma.restockNotificationJob.findMany({
      where: { tenantId: tid, status: "PENDING" },
      select: { id: true, entries: true },
    });
    for (const job of pending) {
      const current = parseEntries(job.entries);
      const filtered = current.filter((e) => e.productColorId !== productColorId);
      if (filtered.length === current.length) continue; // pas concerné
      if (filtered.length === 0) {
        // Plus rien à annoncer → on annule.
        await prisma.restockNotificationJob.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            scheduledSendAt: null,
            entries: [] as unknown as object,
            cancelReason: "ALL_OUT_OF_STOCK_AGAIN",
            lastEvaluatedAt: now,
          },
        });
      } else {
        await prisma.restockNotificationJob.update({
          where: { id: job.id },
          data: {
            entries: filtered as unknown as object,
            lastEvaluatedAt: now,
          },
        });
      }
    }
  } catch (err) {
    logger.error("[restock] drop entry failed", {
      productColorId,
      tenantId: tenantId ?? null,
      error: err as Error,
    });
  }
}

/**
 * Annule tous les jobs PENDING d'un client (opt-out, désinscription,
 * passage non-APPROVED). Idempotent — safe à appeler plusieurs fois.
 */
export async function cancelRestockJob(
  userId: string,
  tenantId: string,
  reason: "OPT_OUT" | "USER_NOT_APPROVED" | "NEWSLETTER_OPT_OUT",
): Promise<void> {
  try {
    await prisma.restockNotificationJob.updateMany({
      where: { userId, tenantId, status: "PENDING" },
      data: {
        status: "CANCELLED",
        scheduledSendAt: null,
        cancelReason: reason,
      },
    });
  } catch (err) {
    logger.error("[restock] cancel job failed", {
      userId,
      tenantId,
      reason,
      error: err as Error,
    });
  }
}

/**
 * Fusionne une nouvelle entrée dans la liste existante. Dédup par
 * `productColorId` ; les flags `isFavorite` / `hasOrdered` sont OR-ésés
 * (une 2e passe ne peut qu'enrichir, jamais déclasser).
 * Exportée pour les tests unitaires.
 */
export function mergeEntries(
  existing: RestockEntry[],
  incoming: RestockEntry,
): RestockEntry[] {
  const idx = existing.findIndex((e) => e.productColorId === incoming.productColorId);
  if (idx === -1) {
    return [...existing, incoming];
  }
  const merged: RestockEntry = {
    ...existing[idx],
    isFavorite: existing[idx].isFavorite || incoming.isFavorite,
    hasOrdered: existing[idx].hasOrdered || incoming.hasOrdered,
  };
  const out = existing.slice();
  out[idx] = merged;
  return out;
}

/**
 * Parse défensif du JSON `entries` stocké en BDD. Rejette silencieusement
 * les entrées malformées (pas de productColorId, flags invalides…) — utile
 * pour les migrations ou données legacy. Exporté pour les tests.
 */
export function parseEntries(raw: unknown): RestockEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): RestockEntry | null => {
      if (!e || typeof e !== "object") return null;
      const rec = e as Record<string, unknown>;
      const productId = typeof rec.productId === "string" ? rec.productId : "";
      const productColorId =
        typeof rec.productColorId === "string" ? rec.productColorId : "";
      const addedAt = typeof rec.addedAt === "string" ? rec.addedAt : "";
      if (!productId || !productColorId || !addedAt) return null;
      return {
        productId,
        productColorId,
        isFavorite: rec.isFavorite === true,
        hasOrdered: rec.hasOrdered === true,
        addedAt,
      };
    })
    .filter((x): x is RestockEntry => x !== null);
}

async function readDelaySeconds(tenantId: string): Promise<number> {
  const cfg = await prisma.siteConfig.findFirst({
    where: { tenantId, key: RESTOCK_DELAY_SITE_CONFIG_KEY },
    select: { value: true },
  });
  const parsed = Number(cfg?.value);
  // Si la cliente a stocké une valeur > 0, on la respecte (y compris 1 s).
  // Pas de valeur stockée OU valeur invalide → défaut 24 h.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RESTOCK_DEFAULT_DELAY_SECONDS;
  }
  return Math.floor(parsed);
}
