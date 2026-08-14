/**
 * Compte les produits publiés sur un marketplace donné qui utilisent un
 * attribut local (Season / Category / Color / Composition), et charge les
 * méta utiles pour enqueuer une resync (id, ref, nom, première image).
 *
 * Sert au déclenchement de la modale « X produits impactés sur {Marketplace} »
 * dans les pages /admin/{saisons|categories|couleurs|compositions} après une
 * modification de mapping marketplace.
 *
 * ATTENTION : le pays n'est PAS géré ici (mapping figé en dur dans
 * lib/countries.ts, cf. règle métier — la cliente n'a pas voulu de modale
 * pour les pays).
 */

import { prisma } from "@/lib/prisma";

// Ré-exporte les types depuis le fichier client-safe pour ne pas casser les
// callers existants (server actions). Les client components importent
// directement depuis @/lib/mapping-impact-types.
export type {
  MappingAttribute,
  MappingMarketplace,
  MappingImpactedProduct,
  MappingImpactResult,
  MappingChangeSummary,
} from "@/lib/mapping-impact-types";
export { marketplaceLabel } from "@/lib/mapping-impact-types";

import type {
  MappingMarketplace,
  MappingAttribute,
  MappingImpactResult,
  MappingImpactedProduct,
  MappingChangeSummary,
} from "@/lib/mapping-impact-types";

const MARKETPLACE_ID_FIELD: Record<MappingMarketplace, string> = {
  pfs: "pfsProductId",
  efashion: "efashionReferenceBase",
  faire: "faireProductId",
};

/**
 * `where` Prisma qui matche les produits publiés sur un marketplace donné
 * (id marketplace non-null).
 */
function publishedOnMarketplaceWhere(marketplace: MappingMarketplace): Record<string, unknown> {
  return { [MARKETPLACE_ID_FIELD[marketplace]]: { not: null } };
}

/**
 * `where` Prisma qui matche les produits utilisant un attribut local donné.
 * Pour composition (relation n-n), on filtre via `compositions.some.compositionId`.
 */
function usesAttributeWhere(attribute: MappingAttribute, localId: string): Record<string, unknown> {
  switch (attribute) {
    case "season":
      return { seasonId: localId };
    case "category":
      return { categoryId: localId };
    case "color":
      // Un produit "utilise" une couleur soit via une de ses variantes,
      // soit via une ligne de pack multi-couleurs. On ratisse large pour
      // ne pas rater les packs.
      return {
        OR: [
          { colors: { some: { colorId: localId } } },
          { colors: { some: { packLines: { some: { colorId: localId } } } } },
          { primaryColorId: localId },
        ],
      };
    case "composition":
      return { compositions: { some: { compositionId: localId } } };
  }
}

/**
 * Compte et charge les produits impactés par un changement de mapping.
 * Retourne un tableau vide si aucun produit n'est publié sur le marketplace
 * concerné (rien à proposer côté UI).
 */
export async function analyzeMappingImpact(params: {
  attribute: MappingAttribute;
  marketplace: MappingMarketplace;
  localId: string;
}): Promise<MappingImpactResult> {
  const { attribute, marketplace, localId } = params;

  const where = {
    AND: [
      usesAttributeWhere(attribute, localId),
      publishedOnMarketplaceWhere(marketplace),
      { status: { not: "ARCHIVED" as const } },
    ],
  };

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      reference: true,
      name: true,
      colors: {
        where: { isPrimary: true },
        select: {
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
        take: 1,
      },
    },
  });

  return {
    count: products.length,
    products: products.map((p) => ({
      id: p.id,
      reference: p.reference,
      name: p.name,
      firstImage: p.colors[0]?.images[0]?.path ?? null,
    })),
  };
}

/**
 * Sucre : lance `analyzeMappingImpact`, retourne `null` si personne n'est
 * impacté (l'UI n'ouvre pas de modale) ou un `MappingChangeSummary` complet
 * à passer au provider `MappingImpactContext`.
 */
export async function buildMappingImpactSummary(params: {
  attribute: MappingAttribute;
  marketplace: MappingMarketplace;
  localId: string;
  localName: string;
  oldValueLabel: string | null;
  newValueLabel: string | null;
  rollbackFields: Record<string, string | number | null>;
}): Promise<MappingChangeSummary | null> {
  const { count } = await analyzeMappingImpact({
    attribute: params.attribute,
    marketplace: params.marketplace,
    localId: params.localId,
  });
  if (count === 0) return null;
  return {
    attribute: params.attribute,
    marketplace: params.marketplace,
    localId: params.localId,
    localName: params.localName,
    count,
    oldValueLabel: params.oldValueLabel,
    newValueLabel: params.newValueLabel,
    rollbackFields: params.rollbackFields,
  };
}

/**
 * Nom du champ Prisma qui porte l'ID marketplace d'un Product, pour les
 * updates de flag syncRequired ou de rollback.
 */
export function marketplaceIdField(mp: MappingMarketplace): string {
  return MARKETPLACE_ID_FIELD[mp];
}

/**
 * Nom du champ `*SyncRequired` d'un Product pour un marketplace donné.
 */
export function marketplaceSyncRequiredField(mp: MappingMarketplace): string {
  return mp === "pfs"
    ? "pfsSyncRequired"
    : mp === "efashion"
      ? "efashionSyncRequired"
      : "faireSyncRequired";
}
