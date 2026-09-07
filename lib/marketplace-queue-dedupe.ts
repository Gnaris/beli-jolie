/**
 * lib/marketplace-queue-dedupe.ts
 *
 * Helper partagé — filtre les drafts d'enqueue pour éviter d'empiler 2 jobs
 * équivalents QUEUED sur le même (productId, marketplace, mode). Utilisé par :
 *   - `/api/admin/marketplace-queue` POST (enqueue depuis le widget UI)
 *   - `lib/pfs-audit-runner.ts` (propagation post-audit auto)
 *   - `lib/rotate-primary-service.ts` (rotation auto couleur principale)
 *
 * Règle métier figée avec la cliente (2026-09-07) :
 *
 *  1. QUEUED existant pour (productId, marketplace, mode) → nouveau draft
 *     ignoré, on renvoie le job existant. Deux REFRESH consécutifs sur le
 *     même produit produiraient le même push, l'unique restant enverra l'état
 *     à jour au moment de son exécution.
 *
 *  2. IN_PROGRESS / AWAITING_CALLBACK existant → PAS de dédoublonnage. Un
 *     nouveau job s'empile derrière — nécessaire pour qu'une modif faite
 *     pendant qu'un push est en cours soit poussée par le job suivant. Le
 *     worker sérialise déjà par productId (mutex de sélection dans
 *     `marketplace-queue-select`), donc le nouveau job attendra son tour.
 *
 *  3. Modes hors dédoublonnage : DELETE / DISABLE / ENABLE et tout mode qui
 *     n'est pas PUBLISH / REFRESH / RESYNC sont des actions ponctuelles
 *     distinctes qu'on doit pouvoir enfiler même pendant un refresh. Ils
 *     passent toujours dans `toCreate`.
 *
 * Contexte tenant : ce helper s'appuie sur la scope extension Prisma qui
 * ajoute automatiquement `tenantId = <current>` sur les findMany. Les callers
 * doivent tourner sous `tenantALS.run(tenantId, …)` (comportement déjà en
 * place dans les 3 callers actuels).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DedupeDbMode =
  | "PUBLISH"
  | "REFRESH"
  | "RESYNC"
  | "DISABLE"
  | "ENABLE"
  | "DELETE";
export type DedupeDbMarketplace =
  | "PFS"
  | "ANKORSTORE"
  | "EFASHION"
  | "FAIRE"
  | "ORDERCHAMP"
  | "MICROSTORE";

/**
 * Modes qui matchent le dédoublonnage : ils poussent tous l'état courant du
 * produit vers la marketplace, donc un second job équivalent est redondant.
 */
export const DEDUPE_MODES: readonly DedupeDbMode[] = [
  "PUBLISH",
  "REFRESH",
  "RESYNC",
] as const;

export function isDedupeMode(m: string): m is (typeof DEDUPE_MODES)[number] {
  return (DEDUPE_MODES as readonly string[]).includes(m);
}

/**
 * Contrat minimal d'un draft d'enqueue — les callers passent leurs propres
 * structures enrichies, le helper conserve la forme originale et retourne le
 * même type dans `toCreate`.
 */
export interface DedupeDraft {
  productId: string;
  marketplace: DedupeDbMarketplace;
  mode: DedupeDbMode;
}

export interface DedupeResult<T extends DedupeDraft> {
  /** Drafts à créer (non dédoublonnés) — même forme que l'entrée. */
  toCreate: T[];
  /** Jobs existants réutilisés (pour renvoyer un état cohérent au caller UI). */
  reused: Prisma.MarketplaceRefreshJobGetPayload<Record<string, never>>[];
  /** Nombre de drafts ignorés parce qu'un QUEUED équivalent existait. */
  deduplicated: number;
}

/**
 * Cherche les jobs QUEUED existants qui matchent les drafts et retourne la
 * partition (à créer / réutilisés). Ne touche PAS à la base — c'est au caller
 * de faire son `prisma.$transaction([…create()…])` avec `toCreate`.
 *
 * @example
 *   const { toCreate, reused, deduplicated } = await dedupeEnqueueDrafts(drafts);
 *   const created = await prisma.$transaction(toCreate.map((d) => prisma.marketplaceRefreshJob.create({…})));
 *   return { created, reused, deduplicated };
 */
export async function dedupeEnqueueDrafts<T extends DedupeDraft>(
  drafts: T[],
): Promise<DedupeResult<T>> {
  if (drafts.length === 0) {
    return { toCreate: [], reused: [], deduplicated: 0 };
  }

  // Ne charge d'existants que si au moins un draft est en mode dédupliable —
  // évite une query BDD inutile pour un batch 100 % DELETE par exemple.
  const dedupeProductIds = [
    ...new Set(
      drafts
        .filter((d) => isDedupeMode(d.mode))
        .map((d) => d.productId),
    ),
  ];

  const activeExisting =
    dedupeProductIds.length > 0
      ? await prisma.marketplaceRefreshJob.findMany({
          where: {
            productId: { in: dedupeProductIds },
            status: "QUEUED",
            mode: { in: [...DEDUPE_MODES] },
          },
        })
      : [];

  const existingByKey = new Map<
    string,
    (typeof activeExisting)[number]
  >();
  for (const job of activeExisting) {
    existingByKey.set(`${job.productId}::${job.marketplace}::${job.mode}`, job);
  }

  const toCreate: T[] = [];
  const reused: typeof activeExisting = [];
  let deduplicated = 0;

  for (const draft of drafts) {
    // Modes non-dédupliables (DELETE/DISABLE/ENABLE) passent toujours.
    if (!isDedupeMode(draft.mode)) {
      toCreate.push(draft);
      continue;
    }
    const key = `${draft.productId}::${draft.marketplace}::${draft.mode}`;
    const existing = existingByKey.get(key);
    if (existing) {
      reused.push(existing);
      deduplicated++;
      continue;
    }
    toCreate.push(draft);
  }

  return { toCreate, reused, deduplicated };
}
