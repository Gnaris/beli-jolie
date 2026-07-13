import { prisma } from "@/lib/prisma";
import {
  getCachedEfashionEnabled,
  getCachedFaireEnabled,
  getCachedPfsCredentials,
} from "@/lib/cached-data";

export type MarketplaceKey = "pfs" | "efashion" | "faire";

export interface UnmappedAttrCount {
  total: number;
  byMarketplace: Partial<Record<MarketplaceKey, number>>;
  reasons: string[];
}

export interface UnmappedAttributes {
  categories: UnmappedAttrCount;
  colors: UnmappedAttrCount;
  compositions: UnmappedAttrCount;
  seasons: UnmappedAttrCount;
  sizes: UnmappedAttrCount;
  countries: UnmappedAttrCount;
  shCodes: UnmappedAttrCount;
  totalUnmapped: number;
}

export interface MarketplaceFlags {
  pfs: boolean;
  efashion: boolean;
  faire: boolean;
}

const MARKETPLACE_LABELS: Record<MarketplaceKey, string> = {
  pfs: "PFS",
  efashion: "eFashion",
  faire: "Faire",
};

function buildReasons(byMarketplace: Partial<Record<MarketplaceKey, number>>): string[] {
  return (Object.keys(byMarketplace) as MarketplaceKey[])
    .filter((k) => (byMarketplace[k] ?? 0) > 0)
    .map((k) => `${byMarketplace[k]} sans lien ${MARKETPLACE_LABELS[k]}`);
}

function buildCount(
  byMarketplace: Partial<Record<MarketplaceKey, number>>,
  total: number,
): UnmappedAttrCount {
  return { total, byMarketplace, reasons: buildReasons(byMarketplace) };
}

function orClauses(clauses: Array<false | 0 | null | undefined | object>): object[] {
  return clauses.filter((c): c is object => !!c && typeof c === "object");
}

async function countWithOr(
  model: { count: (args: { where: object }) => Promise<number> },
  scope: object,
  clauses: Array<false | object>,
): Promise<number> {
  const or = orClauses(clauses);
  if (!or.length) return 0;
  return model.count({ where: { ...scope, OR: or } });
}

async function safeCount(
  enabled: boolean,
  model: { count: (args: { where: object }) => Promise<number> },
  where: object,
): Promise<number> {
  if (!enabled) return 0;
  return model.count({ where });
}

export async function loadMarketplaceFlags(): Promise<MarketplaceFlags> {
  const [pfsCreds, efashion, faire] = await Promise.all([
    getCachedPfsCredentials(),
    getCachedEfashionEnabled(),
    getCachedFaireEnabled(),
  ]);
  return {
    pfs: !!(pfsCreds.email && pfsCreds.password),
    efashion,
    faire,
  };
}

export async function computeUnmappedAttributes(
  tid: string,
  flags: MarketplaceFlags,
): Promise<UnmappedAttributes> {
  // Scope tenant explicite : les callbacks d'unstable_cache peuvent perdre
  // l'ALS en Next 16, donc on passe tenantId à la main pour éviter la fuite.
  const scope = tid === "global" ? {} : { tenantId: tid };

  const [
    catPfs, catEf, catFaire, catTotal,
    colPfs, colEf, colTotal,
    compPfs, compEf, compFaire, compTotal,
    seaPfs, seaEf, seaTotal,
    sizPfs, sizTotal,
    couPfs, couEf, couFaire, couTotal,
    shFaire,
  ] = await Promise.all([
    // Catégories
    safeCount(flags.pfs, prisma.category, { ...scope, pfsCategoryId: null }),
    safeCount(flags.efashion, prisma.category, { ...scope, efashionCategorieId: null }),
    safeCount(flags.faire, prisma.category, { ...scope, faireTaxonomyId: null }),
    countWithOr(prisma.category, scope, [
      flags.pfs && { pfsCategoryId: null },
      flags.efashion && { efashionCategorieId: null },
      flags.faire && { faireTaxonomyId: null },
    ]),
    // Couleurs
    safeCount(flags.pfs, prisma.color, { ...scope, pfsColorRef: null }),
    safeCount(flags.efashion, prisma.color, { ...scope, efashionColorId: null }),
    countWithOr(prisma.color, scope, [
      flags.pfs && { pfsColorRef: null },
      flags.efashion && { efashionColorId: null },
    ]),
    // Compositions
    safeCount(flags.pfs, prisma.composition, { ...scope, pfsCompositionRef: null }),
    safeCount(flags.efashion, prisma.composition, { ...scope, efashionId: null }),
    safeCount(flags.faire, prisma.composition, { ...scope, faireMaterialLabel: null }),
    countWithOr(prisma.composition, scope, [
      flags.pfs && { pfsCompositionRef: null },
      flags.efashion && { efashionId: null },
      flags.faire && { faireMaterialLabel: null },
    ]),
    // Saisons
    safeCount(flags.pfs, prisma.season, { ...scope, pfsRef: null }),
    safeCount(flags.efashion, prisma.season, { ...scope, efashionCollectionId: null }),
    countWithOr(prisma.season, scope, [
      flags.pfs && { pfsRef: null },
      flags.efashion && { efashionCollectionId: null },
    ]),
    // Tailles
    safeCount(flags.pfs, prisma.size, { ...scope, pfsSizeRef: null }),
    countWithOr(prisma.size, scope, [
      flags.pfs && { pfsSizeRef: null },
    ]),
    // Pays d'origine — PFS considère un pays mappé si isoCode OU pfsCountryRef présent
    safeCount(flags.pfs, prisma.manufacturingCountry, {
      ...scope,
      isoCode: null,
      pfsCountryRef: null,
    }),
    safeCount(flags.efashion, prisma.manufacturingCountry, { ...scope, efashionProvenanceId: null }),
    safeCount(flags.faire, prisma.manufacturingCountry, { ...scope, faireCountryCode: null }),
    countWithOr(prisma.manufacturingCountry, scope, [
      flags.pfs && { AND: [{ isoCode: null }, { pfsCountryRef: null }] },
      flags.efashion && { efashionProvenanceId: null },
      flags.faire && { faireCountryCode: null },
    ]),
    // Codes SH (table globale, pas de scope tenant) — mapping Faire uniquement
    safeCount(flags.faire, prisma.hsCode, { faireFormat: null }),
  ]);

  const categories = buildCount({ pfs: catPfs, efashion: catEf, faire: catFaire }, catTotal);
  const colors = buildCount({ pfs: colPfs, efashion: colEf }, colTotal);
  const compositions = buildCount({ pfs: compPfs, efashion: compEf, faire: compFaire }, compTotal);
  const seasons = buildCount({ pfs: seaPfs, efashion: seaEf }, seaTotal);
  const sizes = buildCount({ pfs: sizPfs }, sizTotal);
  const countries = buildCount({ pfs: couPfs, efashion: couEf, faire: couFaire }, couTotal);
  const shCodes = buildCount({ faire: shFaire }, shFaire);

  const totalUnmapped =
    categories.total +
    colors.total +
    compositions.total +
    seasons.total +
    sizes.total +
    countries.total +
    shCodes.total;

  return {
    categories,
    colors,
    compositions,
    seasons,
    sizes,
    countries,
    shCodes,
    totalUnmapped,
  };
}

/**
 * Génère la ligne d'infobulle affichée sur le sous-item :
 *   « 3 catégories sans mapping » (titre)
 *   Détail = list of reasons
 * Utilisé côté client pour rendre le tooltip.
 */
export function formatAttrLabel(kind: keyof Omit<UnmappedAttributes, "totalUnmapped">, count: number): string {
  const labels: Record<keyof Omit<UnmappedAttributes, "totalUnmapped">, [string, string]> = {
    categories: ["catégorie sans mapping", "catégories sans mapping"],
    colors: ["couleur sans mapping", "couleurs sans mapping"],
    compositions: ["composition sans mapping", "compositions sans mapping"],
    seasons: ["saison sans mapping", "saisons sans mapping"],
    sizes: ["taille sans mapping", "tailles sans mapping"],
    countries: ["pays sans mapping", "pays sans mapping"],
    shCodes: ["code SH sans format Faire", "codes SH sans format Faire"],
  };
  const [singular, plural] = labels[kind];
  return `${count} ${count > 1 ? plural : singular}`;
}
