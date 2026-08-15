/**
 * lib/marketplace-queue-select.ts
 *
 * Sélection pure des jobs à démarrer depuis la file `MarketplaceRefreshJob`.
 *
 * Séparé du worker pour rester testable sans mocker Prisma.
 *
 * Règles :
 *  - Respect du budget total (tous marketplaces confondus).
 *  - Respect du budget Ankorstore (sous-limite dédiée).
 *  - Respect du budget Faire (sous-limite dédiée, protection Cloudflare
 *    rate-limit — 2026-08-15).
 *  - **Sérialisation par produit côté Ankorstore** : un seul job Ankor à la
 *    fois par `productId` (2026-08-15). Sans ce verrou, deux jobs Ankor
 *    concurrents sur le même produit orphelinent les SKU (cf. incident
 *    2026-08-12, rollback à concurrence 1). Avec ce verrou, on peut ré-ouvrir
 *    la concurrence Ankor à 5 en toute sécurité pour les produits **distincts**.
 *
 * Le verrou est appliqué à la fois sur les jobs Ankor déjà en vol (`inFlightAnkorProductIds`)
 * et sur ceux sélectionnés plus tôt dans le même tick.
 */

export interface SelectableJob {
  marketplace: string;
  productId: string;
}

export interface SelectJobsInput<T extends SelectableJob> {
  /** Jobs QUEUED candidats, déjà triés (ordre chronologique). */
  queued: T[];
  /** Product IDs des jobs Ankor actuellement IN_PROGRESS ou AWAITING_CALLBACK. */
  inFlightAnkorProductIds: Iterable<string>;
  /** Nombre max de jobs à démarrer ce tick, tous marketplaces confondus. */
  totalBudget: number;
  /** Budget Ankor restant (limite dédiée). */
  ankorsBudget: number;
  /**
   * Budget Faire restant (limite dédiée). Optionnel — si absent, aucun
   * plafond spécifique à Faire n'est appliqué (les tests unitaires qui ne
   * ciblent pas Faire peuvent omettre ce champ).
   */
  fairesBudget?: number;
}

export function selectJobsToStart<T extends SelectableJob>(input: SelectJobsInput<T>): T[] {
  const lockedAnkorProductIds = new Set(input.inFlightAnkorProductIds);
  let ankorsBudget = input.ankorsBudget;
  let fairesBudget = input.fairesBudget ?? Infinity;
  const toStart: T[] = [];
  for (const job of input.queued) {
    if (toStart.length >= input.totalBudget) break;
    if (job.marketplace === "ANKORSTORE") {
      if (ankorsBudget <= 0) continue;
      if (lockedAnkorProductIds.has(job.productId)) continue;
      lockedAnkorProductIds.add(job.productId);
      ankorsBudget--;
    } else if (job.marketplace === "FAIRE") {
      if (fairesBudget <= 0) continue;
      fairesBudget--;
    }
    toStart.push(job);
  }
  return toStart;
}
