/**
 * lib/marketplace-job-intent.ts
 *
 * Résolution de l'intention métier d'un job marketplace au moment de l'enqueue.
 * Le widget marketplaces utilise cette intention pour router chaque job dans
 * l'onglet correspondant (Création / Modification / Synchronisation /
 * Rafraîchissement / Étalement / Liaison).
 *
 * Règles :
 *  - LINK      : posé explicitement par les flows de liaison manuelle
 *  - SCHEDULED : quand scheduledFor est renseigné avec un intervalMs > 0
 *  - REFRESH   : mode === "refresh" (immédiat, sans étalement)
 *  - CREATE    : mode === "publish" ET produit sans ID marketplace
 *  - SYNC      : mode === "resync" (badge orange « synchro nécessaire » ou
 *                bouton ↻ resync forcé — renvoi complet sur la même fiche)
 *  - UPDATE    : dans tous les autres cas (mode "publish" avec ID connu,
 *                actions verify-apply, disable/enable/delete Microstore, etc.)
 */
import { prisma } from "@/lib/prisma";
import type { ClientMarketplace, ClientMode } from "@/lib/marketplace-queue-serializer";

export type MarketplaceJobIntentValue = "CREATE" | "UPDATE" | "SYNC" | "REFRESH" | "SCHEDULED" | "LINK";

export interface ResolveIntentInput {
  productId: string;
  marketplace: ClientMarketplace;
  mode: ClientMode;
  /** true si le job est étalé dans le temps (scheduledFor + intervalMs). */
  scheduled: boolean;
  /** Forçage explicite : posé par les flows de liaison (link*Manually). */
  explicitIntent?: MarketplaceJobIntentValue;
}

const ID_FIELD_BY_MARKETPLACE: Record<ClientMarketplace, string> = {
  pfs: "pfsProductId",
  ankorstore: "ankorsProductId",
  efashion: "efashionReferenceBase",
  faire: "faireProductId",
  orderchamp: "orderchampProductId",
  microstore: "microstoreProductId",
};

/**
 * Vérifie en base si le produit possède déjà un ID marketplace. Sert à
 * distinguer une première publication (CREATE) d'une modification (UPDATE)
 * quand le mode est "publish".
 */
async function hasMarketplaceId(productId: string, marketplace: ClientMarketplace): Promise<boolean> {
  const field = ID_FIELD_BY_MARKETPLACE[marketplace];
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
    },
  });
  if (!product) return false;
  const value = (product as Record<string, unknown>)[field];
  // microstoreProductId est un Int? — les autres sont des String?. On accepte
  // les deux : présence = déjà lié.
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

export async function resolveJobIntent(input: ResolveIntentInput): Promise<MarketplaceJobIntentValue> {
  if (input.explicitIntent) return input.explicitIntent;
  if (input.scheduled) return "SCHEDULED";
  if (input.mode === "refresh") return "REFRESH";
  if (input.mode === "resync") return "SYNC";
  if (input.mode === "publish") {
    const linked = await hasMarketplaceId(input.productId, input.marketplace);
    return linked ? "UPDATE" : "CREATE";
  }
  // disable/enable/delete Microstore + tous cas restants (verify-apply, etc.)
  return "UPDATE";
}

/**
 * Résout en masse pour un lot d'inputs — factorise les requêtes produit :
 * un seul SELECT groupé au lieu d'un appel par item.
 */
export async function resolveJobIntentsBulk(
  inputs: Array<Omit<ResolveIntentInput, "productId"> & { productId: string }>,
): Promise<MarketplaceJobIntentValue[]> {
  // Fast path : pas d'input "publish" → aucune requête produit nécessaire.
  const needsProductCheck = inputs.some(
    (i) => !i.explicitIntent && !i.scheduled && i.mode === "publish",
  );

  if (!needsProductCheck) {
    return inputs.map((i) => {
      if (i.explicitIntent) return i.explicitIntent;
      if (i.scheduled) return "SCHEDULED" as const;
      if (i.mode === "refresh") return "REFRESH" as const;
      if (i.mode === "resync") return "SYNC" as const;
      return "UPDATE" as const;
    });
  }

  const productIds = Array.from(new Set(inputs.map((i) => i.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return inputs.map((input) => {
    if (input.explicitIntent) return input.explicitIntent;
    if (input.scheduled) return "SCHEDULED" as const;
    if (input.mode === "refresh") return "REFRESH" as const;
    if (input.mode === "resync") return "SYNC" as const;
    if (input.mode === "publish") {
      const product = byId.get(input.productId);
      const field = ID_FIELD_BY_MARKETPLACE[input.marketplace];
      const value = product ? (product as Record<string, unknown>)[field] : undefined;
      const linked =
        (typeof value === "string" && value.length > 0) ||
        (typeof value === "number" && Number.isFinite(value));
      return linked ? ("UPDATE" as const) : ("CREATE" as const);
    }
    return "UPDATE" as const;
  });
}
