// Service d'orchestration de la rotation automatique de la couleur principale.
//
// À appeler après CHAQUE mutation de stock d'une variante (updateVariantQuick,
// adjustStock, placeOrder, déductions marketplaces, import, formulaire complet
// n'est PAS branché — cf. memory 2026-06-30 : la cliente choisit elle-même
// dans le formulaire).
//
// Debounce (2026-08-14) : la fonction publique rotatePrimaryIfNeeded est
// debouncée par produit. Plusieurs appels rapprochés sur le même produit
// (ex: cliente met plusieurs variantes en rupture d'affilée) fusionnent en
// une seule rotation évaluée sur l'état FINAL. Sans ça, une rotation
// intermédiaire pouvait basculer la principale vers une couleur qui allait
// juste après passer à 0 aussi — apparence de rotation "gratuite" côté UI.
//
// Flow interne :
//   1) Lit le produit + variantes + IDs marketplace
//   2) Appelle decidePrimaryRotation() pour trancher
//   3) Si rotation → update Product.primaryColorId (idempotent via WHERE)
//   4) Enqueue 1 MarketplaceRefreshJob (mode PUBLISH = colonne "Modifications"
//      du widget) par marketplace lié+activé → la queue widget flottant
//      orchestre, respecte le mutex Ankorstore, etc.
//   5) revalidateTag pour rafraîchir l'admin
//
// Marketplaces poussés : PFS, Ankorstore, eFashion, Faire. Microstore n'a pas
// de queue marketplace (pas de push serveur → syncRequired est posé par les
// mutations produit habituelles).
import "server-only";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { tenantALS } from "@/lib/tenant-als";
import { getCurrentTenantIdSafe } from "@/lib/tenant";
import { decidePrimaryRotation } from "@/lib/auto-rotate-primary";
import { emitProductEvent } from "@/lib/product-events";

export interface RotationResult {
  rotated: boolean;
  from?: string | null;
  to?: string;
  enqueuedJobs?: number;
}

/** Fenêtre de debounce — plusieurs appels sur le même produit fusionnent. */
const DEBOUNCE_MS = 2000;

interface PendingRotation {
  timer: NodeJS.Timeout;
  tenantId: string | null;
}

/** Timers en vol, indexés par productId. Global (module-scope) = partagé par toute l'app. */
const pendingRotations = new Map<string, PendingRotation>();

/**
 * Programme une évaluation de rotation pour ce produit. Debounced à
 * `DEBOUNCE_MS` : si un autre appel arrive avant la fin du délai, le timer
 * précédent est annulé et re-programmé. Résultat : sur une rafale de
 * mutations, on n'évalue la rotation qu'UNE FOIS sur l'état final.
 *
 * Retour immédiat `{ rotated: false }` — l'évaluation est fire-and-forget.
 * Les callsites qui ont besoin d'un vrai retour synchrone doivent passer
 * `opts.immediate = true` (utilisé par les tests).
 *
 * @param productId - Product.id de la fiche à évaluer
 * @param opts.tenantId - Optionnel. Si fourni, wrap l'exécution dans
 *   tenantALS.run() au tick du timer. Sinon on résout via ALS/headers courants
 *   AVANT le setTimeout (le contexte HTTP est mort au tick).
 * @param opts.immediate - Bypass le debounce, exécute tout de suite (tests).
 */
export async function rotatePrimaryIfNeeded(
  productId: string,
  opts: { tenantId?: string | null; immediate?: boolean } = {},
): Promise<RotationResult> {
  // Résout tenantId AVANT de programmer le timer : le contexte HTTP peut
  // être clos au moment du tick, donc `headers()` ne fonctionnera plus.
  let tenantId: string | null = opts.tenantId ?? null;
  if (!tenantId) {
    tenantId = await getCurrentTenantIdSafe();
  }

  const runWithTenant = async (): Promise<RotationResult> => {
    if (tenantId) {
      return tenantALS.run(tenantId, () => rotatePrimaryInner(productId));
    }
    return rotatePrimaryInner(productId);
  };

  if (opts.immediate) {
    return runWithTenant();
  }

  const existing = pendingRotations.get(productId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pendingRotations.delete(productId);
    runWithTenant().catch((err) =>
      logger.error("[RotatePrimary] tick debounced error", { productId, error: err }),
    );
  }, DEBOUNCE_MS);
  // Le timer ne doit pas bloquer l'arrêt du process (worker, dev restart).
  timer.unref?.();

  pendingRotations.set(productId, { timer, tenantId });

  return { rotated: false };
}

async function rotatePrimaryInner(productId: string): Promise<RotationResult> {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        primaryColorId: true,
        pfsProductId: true,
        ankorsProductId: true,
        efashionReferenceBase: true,
        faireProductId: true,
        pfsEnabled: true,
        ankorsEnabled: true,
        efashionEnabled: true,
        faireEnabled: true,
        colors: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            colorId: true,
            stock: true,
            disabled: true,
          },
        },
      },
    });
    if (!product) return { rotated: false };

    const decision = decidePrimaryRotation({
      currentPrimaryColorId: product.primaryColorId,
      colors: product.colors,
    });
    if (!decision) return { rotated: false };

    // Update idempotent : le WHERE sur primaryColorId courant empêche une
    // double rotation si deux mutations concurrentes déclenchent le service
    // pour le même produit au même instant.
    const updated = await prisma.product.updateMany({
      where: { id: productId, primaryColorId: product.primaryColorId },
      data: { primaryColorId: decision.nextPrimaryColorId },
    });
    if (updated.count === 0) {
      // Un autre process a déjà roté entre notre lecture et notre update.
      return { rotated: false };
    }

    // Enqueue en mode PUBLISH (= colonne "Modifications" du widget) : la
    // rotation est une conséquence d'une modif locale, pas un "Rafraîchir"
    // volontaire. Un job par marketplace cible liée + activée.
    const basePayload = {
      reference: product.reference,
      productName: product.name,
      firstImage: null as string | null,
    };
    const jobs: Array<{
      marketplace: "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE";
      options: Record<string, boolean>;
    }> = [];
    if (product.pfsProductId && product.pfsEnabled) {
      jobs.push({ marketplace: "PFS", options: { pfs: true } });
    }
    if (product.ankorsProductId && product.ankorsEnabled) {
      jobs.push({ marketplace: "ANKORSTORE", options: { ankorstore: true } });
    }
    if (product.efashionReferenceBase && product.efashionEnabled) {
      jobs.push({ marketplace: "EFASHION", options: { efashion: true } });
    }
    if (product.faireProductId && product.faireEnabled) {
      jobs.push({ marketplace: "FAIRE", options: { faire: true } });
    }

    if (jobs.length > 0) {
      await prisma.$transaction(
        jobs.map((j) =>
          prisma.marketplaceRefreshJob.create({
            data: {
              productId,
              marketplace: j.marketplace,
              mode: "PUBLISH",
              status: "QUEUED",
              payload: { ...basePayload, options: j.options },
            },
          }),
        ),
      );
    }

    revalidateTag("admin-products", "default");
    // Notifie les UI qui écoutent le stream SSE (fiche produit, tableau
    // catalogue admin) que le produit vient de changer — sans ça, la cliente
    // resterait sur l'ancien affichage de la couleur principale jusqu'à un
    // refresh manuel de la page.
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
    logger.info("[RotatePrimary] rotation appliquée", {
      productId,
      reference: product.reference,
      from: product.primaryColorId,
      to: decision.nextPrimaryColorId,
      enqueuedJobs: jobs.length,
    });

    return {
      rotated: true,
      from: product.primaryColorId,
      to: decision.nextPrimaryColorId,
      enqueuedJobs: jobs.length,
    };
  } catch (error) {
    logger.error("[RotatePrimary] échec silencieux", { productId, error });
    return { rotated: false };
  }
}
