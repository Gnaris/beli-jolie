import type { Prisma, PrismaClient } from "@prisma/client";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

export type AdminProductsRefreshValue =
  | ""
  | "never"
  | "recent"
  | "refreshed"
  | "dateDesc"
  | "dateAsc"
  | "modifiedDesc"
  | "modifiedAsc";

/**
 * Valeurs possibles pour le paramètre URL `sort` — tri explicite du tableau
 * admin des produits, indépendant du filtre `refresh`. Vide/absent = défaut
 * (`createdAt` desc). `sort` prend la priorité sur les valeurs de tri héritées
 * de `refresh` (`dateDesc/Asc`, `modifiedDesc/Asc`) quand les deux sont posés.
 */
export type AdminProductsSortValue =
  | ""
  | "createdDesc"
  | "createdAsc"
  | "modifiedDesc"
  | "modifiedAsc"
  | "importantFirst"
  | "custom";

/**
 * Valeurs possibles pour les filtres "Dernier export marketplace" — un filtre
 * par marketplace (PFS, eFashion, Microstore, Ankorstore). On expose volontairement
 * une grille à 5 paliers (jamais → > 90j) plutôt qu'un date-picker : la cliente
 * raisonne en "il y a longtemps" plus qu'en date précise.
 */
export type AdminProductsExportedValue =
  | ""
  | "never"
  | "lt7d"
  | "lt30d"
  | "gt30d"
  | "gt90d";

export interface AdminProductsFilterParams {
  q?: string;
  exactRef?: boolean;
  cat?: string;
  subCat?: string;
  tag?: string;
  composition?: string;
  bestSeller?: string; // "1" | ""
  /**
   * Filtre « Importants seulement » (favoris admin). "1" = filtre actif.
   * Le marqueur `Product.important` est partagé entre tous les comptes admin.
   */
  important?: string; // "1" | ""
  /**
   * Raccourci « Créé récemment » : ne retient que les produits créés dans les
   * 30 derniers jours (cohérent avec la notion de « Nouveauté » côté public).
   * Combiné en AND avec `dateFrom` : on garde la borne la plus restrictive.
   * "1" = filtre actif.
   */
  createdRecent?: string; // "1" | ""
  /**
   * Raccourci « Modifié récemment » : ne retient que les produits dont
   * `updatedAt` est dans les 30 derniers jours. Combiné en AND avec
   * `updatedFrom` : on garde la borne la plus restrictive. "1" = filtre actif.
   */
  updatedRecent?: string; // "1" | ""
  refresh?: string; // AdminProductsRefreshValue
  status?: string; // ProductStatus | "DRAFT"
  minPrice?: number | null;
  maxPrice?: number | null;
  dateFrom?: string;
  dateTo?: string;
  /**
   * Bornes du filtre « Date de dernière modification » — mappées sur
   * `Product.updatedAt`. `updatedTo` est étendue à 23:59:59.999 pour couvrir
   * toute la journée (même logique que `dateTo`).
   */
  updatedFrom?: string;
  updatedTo?: string;
  stockBelow?: number | null;
  /**
   * Filtres « lien marketplace » — alignés sur le badge vert de la table admin,
   * qui ne regarde que l'ID globale (produit) : un produit est « lié » dès que
   * son identifiant marketplace est renseigné. Les couleurs partiellement liées
   * (produit lié mais 1 variante UNIT sans `*VariantId`) sont signalées à part
   * par le badge orange « Synchronisation nécessaire ».
   *
   * En mode `unlinked`, les produits verrouillés pour la marketplace concernée
   * (`Product.*Enabled = false`) sont exclus des résultats : elles ne sont pas
   * candidates à une publication (le verrou empêche tout push), inutile qu'elles
   * polluent la liste des « à publier ».
   *
   * Colonnes utilisées :
   *  - PFS         : `pfsProductId`             + `pfsEnabled`
   *  - Ankorstore  : `ankorsProductId`          + `ankorsEnabled`
   *  - eFashion    : `efashionReferenceBase`    + `efashionEnabled`
   *  - Faire       : `faireProductId`           + `faireEnabled`
   *  - Orderchamp  : `orderchampProductId`      + `orderchampEnabled`
   *  - Microstore  : `microstoreLastPushedAt`   + `microstoreEnabled`
   *    (Microstore n'a pas d'ID fiable — la CSV historique ne le renseignait
   *    pas — donc le badge et le filtre utilisent le timestamp de dernier push.)
   */
  pfsLink?: string;
  ankorsLink?: string;
  efashionLink?: string;
  faireLink?: string;
  orderchampLink?: string;
  microstoreLink?: string;
  /**
   * Filtre « Synchronisation marketplace nécessaire » : ne retient que les
   * produits avec au moins un drapeau `*SyncRequired = true` (PFS, Ankorstore
   * ou eFashion). Sert à retrouver d'un coup les fiches qui attendent un
   * push depuis le dernier save / upload d'images.
   *   - "1" = filtre actif
   *   - "" (ou absent) = pas de filtre
   */
  syncRequired?: string;
  /**
   * Filtres « Dernier export marketplace » — un par marketplace. Les bornes 7j /
   * 30j / 90j sont relatives à `params.now` (override possible côté tests).
   * Vide ou absent = pas de filtre. Voir `AdminProductsExportedValue`.
   */
  pfsExportedAt?: string;
  efashionExportedAt?: string;
  microstoreExportedAt?: string;
  ankorstoreExportedAt?: string;
  faireExportedAt?: string;
  orderchampExportedAt?: string;
  /**
   * Filtre « Statut de traduction » — vérifie la présence de traductions pour
   * chaque locale non-FR (cf. `NON_DEFAULT_LOCALES`). Cohérent avec le comptage
   * `getCachedAdminWarnings.untranslatedCount` :
   *   - "untranslated" = au moins une locale non-FR manquante
   *   - "translated"   = traduction présente pour chaque locale non-FR
   *   - vide/absent    = pas de filtre
   */
  translationStatus?: string;
  /**
   * Filtre sur le code SH (douanier) du produit, désormais en relation
   * avec la bibliothèque HsCode :
   *   - `""`         = pas de filtre (tous)
   *   - `"__none__"` = produits sans code SH (hsCodeId NULL)
   *   - autre        = id du code SH (égalité stricte sur Product.hsCodeId)
   */
  hsCodeId?: string;
  /**
   * Filtre « Verrouillé » : ne retient que les produits avec le verrou manuel
   * activé (Product.locked = true).
   *   - "1" = filtre actif
   *   - "" (ou absent) = pas de filtre
   */
  locked?: string;
  /**
   * Filtre « Résultat de vérification PFS » — cf. `lib/pfs-verify.ts` et la
   * pastille dans la colonne Produit. Ne s'applique qu'aux produits liés à PFS
   * (produit non lié = jamais vérifiable, ignoré). Valeurs :
   *   - "ok"        = dernière vérif conforme
   *   - "diff"      = dernière vérif avec écarts
   *   - "unchecked" = produit lié à PFS mais jamais vérifié (pfsCheckedAt IS NULL)
   *   - vide/absent = pas de filtre
   */
  pfsVerify?: string;
  /**
   * Liste des productId à retenir (intersection). Quand le filtre
   * « variantes sans image » est actif, on précalcule les IDs côté serveur
   * via une requête SQL et on les passe ici. `null`/undefined = filtre inactif,
   * `[]` = aucun produit ne correspond.
   */
  productIdsIn?: string[] | null;
  /**
   * Liste des productId à exclure. Utilisé pour le filtre inverse
   * « toutes les variantes ont au moins une image » : on reprend les IDs
   * « avec au moins une variante sans image » et on les met en `notIn`.
   */
  productIdsNotIn?: string[] | null;
  /** Reference date for "recent" refresh window (defaults to now). Tests inject a fixed value. */
  now?: Date;
}

const RECENT_REFRESH_DAYS = 30;

const EXPORT_FIELD_BY_MARKETPLACE = {
  pfs:        "pfsLastExportedAt",
  efashion:   "efashionLastExportedAt",
  microstore: "microstoreLastExportedAt",
  ankorstore: "ankorstoreLastExportedAt",
  faire:      "faireLastExportedAt",
  orderchamp: "orderchampLastExportedAt",
} as const;

type ExportMarketplaceKey = keyof typeof EXPORT_FIELD_BY_MARKETPLACE;

/**
 * Construit la clause Prisma pour un filtre « Dernier export » d'une marketplace.
 * Retourne `null` si le filtre est inactif (chaîne vide ou valeur inconnue) — le
 * caller doit alors ne rien ajouter au WHERE.
 *
 * Garde la logique strictement déclarative : `never` = `IS NULL`, `lt*` = exporté
 * récemment, `gt*` = exporté il y a longtemps (et donc forcément pas NULL).
 */
function buildExportedAtClause(
  marketplace: ExportMarketplaceKey,
  value: string | undefined,
  now: Date,
): Prisma.ProductWhereInput | null {
  if (!value) return null;
  const field = EXPORT_FIELD_BY_MARKETPLACE[marketplace];
  const cutoff = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };
  switch (value) {
    case "never":  return { [field]: null };
    case "lt7d":   return { [field]: { gte: cutoff(7) } };
    case "lt30d":  return { [field]: { gte: cutoff(30) } };
    case "gt30d":  return { [field]: { lt: cutoff(30) } };
    case "gt90d":  return { [field]: { lt: cutoff(90) } };
    default:       return null;
  }
}

export function buildAdminProductsWhere(params: AdminProductsFilterParams): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (params.q) {
    const terms = params.q
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (terms.length === 1) {
      const term = terms[0];
      if (params.exactRef) {
        where.reference = { equals: term.toUpperCase() };
      } else {
        // Recherche libre : nom contient OR référence commence par (LIKE 'TERM%')
        where.OR = [
          { name: { contains: term } },
          { reference: { startsWith: term } },
        ];
      }
    } else if (terms.length > 1) {
      if (params.exactRef) {
        where.reference = { in: terms.map((t) => t.toUpperCase()) };
      } else {
        where.OR = terms.flatMap((t) => [
          { name: { contains: t } },
          { reference: { startsWith: t } },
        ]);
      }
    }
  }

  // La cliente veut pouvoir filtrer « Sans catégorie » même si `categoryId`
  // est obligatoire au schéma (contrainte FK). En pratique aucun produit ne
  // devrait matcher — mais si un import ou une migration a laissé une donnée
  // incohérente en base, le filtre le remonte. On force un id impossible ;
  // Prisma refuse `null` sur un champ obligatoire en TypeScript strict.
  if (params.cat === "__none__") {
    where.categoryId = "__no_category__";
  } else if (params.cat) {
    where.categoryId = params.cat;
  }

  if (params.subCat === "__none__") {
    where.subCategories = { none: {} };
  } else if (params.subCat) {
    where.subCategories = { some: { id: params.subCat } };
  }

  if (params.tag === "__none__") {
    where.tags = { none: {} };
  } else if (params.tag) {
    where.tags = { some: { tagId: params.tag } };
  }

  if (params.composition === "__none__") {
    where.compositions = { none: {} };
  } else if (params.composition) {
    where.compositions = { some: { compositionId: params.composition } };
  }

  if (params.bestSeller === "1") {
    where.isBestSeller = true;
  }

  if (params.important === "1") {
    where.important = true;
  }

  const now = params.now ?? new Date();
  if (params.refresh === "never") {
    where.lastRefreshedAt = null;
  } else if (params.refresh === "refreshed") {
    where.lastRefreshedAt = { not: null };
  } else if (params.refresh === "recent") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    where.lastRefreshedAt = { gte: cutoff };
  }
  // `dateDesc` / `dateAsc` / `modifiedDesc` / `modifiedAsc` are sort options
  // handled by buildAdminProductsOrderBy and intentionally do not narrow the where clause.

  if (params.status === "DRAFT") {
    where.status = "OFFLINE";
    where.isIncomplete = true;
  } else if (params.status === "OFFLINE") {
    where.status = "OFFLINE";
    where.isIncomplete = false;
  } else if (params.status === "ONLINE" || params.status === "ARCHIVED") {
    where.status = params.status;
  }

  const min = params.minPrice ?? null;
  const max = params.maxPrice ?? null;
  if (min !== null || max !== null) {
    where.colors = {
      some: {
        unitPrice: {
          ...(min !== null && { gte: min }),
          ...(max !== null && { lte: max }),
        },
      },
    };
  }

  if (params.dateFrom) {
    where.createdAt = { ...(where.createdAt as object), gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    const end = new Date(params.dateTo);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...(where.createdAt as object), lte: end };
  }

  if (params.updatedFrom) {
    where.updatedAt = { ...(where.updatedAt as object), gte: new Date(params.updatedFrom) };
  }
  if (params.updatedTo) {
    const end = new Date(params.updatedTo);
    end.setHours(23, 59, 59, 999);
    where.updatedAt = { ...(where.updatedAt as object), lte: end };
  }

  // Raccourcis « récemment » (barre d'onglets) — combinés en AND avec les bornes
  // date-picker existantes : on garde la borne inférieure la plus restrictive
  // (le max entre la borne explicite et now - 30j).
  if (params.createdRecent === "1") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    const existing = (where.createdAt as { gte?: Date } | undefined)?.gte;
    const gte = existing && existing > cutoff ? existing : cutoff;
    where.createdAt = { ...(where.createdAt as object), gte };
  }
  if (params.updatedRecent === "1") {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - RECENT_REFRESH_DAYS);
    const existing = (where.updatedAt as { gte?: Date } | undefined)?.gte;
    const gte = existing && existing > cutoff ? existing : cutoff;
    where.updatedAt = { ...(where.updatedAt as object), gte };
  }

  const stockBelow = params.stockBelow ?? null;
  if (stockBelow !== null && !Number.isNaN(stockBelow)) {
    const existingSome = (where.colors && "some" in where.colors ? where.colors.some : undefined) ?? {};
    where.colors = {
      some: { ...existingSome, stock: { lte: stockBelow } },
    };
  }

  // Filtres « lien marketplace » (voir docstring `pfsLink`) — alignés sur les
  // badges verts (ID global uniquement, jamais la vérif des variantes UNIT) et
  // en mode `unlinked` on retire les produits verrouillés (`*Enabled = false`)
  // qui ne sont pas candidats à publication.
  if (params.pfsLink === "linked") {
    where.pfsProductId = { not: null };
  } else if (params.pfsLink === "unlinked") {
    where.pfsProductId = null;
    where.pfsEnabled = true;
  }

  if (params.ankorsLink === "linked") {
    where.ankorsProductId = { not: null };
  } else if (params.ankorsLink === "unlinked") {
    where.ankorsProductId = null;
    where.ankorsEnabled = true;
  }

  if (params.efashionLink === "linked") {
    where.efashionReferenceBase = { not: null };
  } else if (params.efashionLink === "unlinked") {
    where.efashionReferenceBase = null;
    where.efashionEnabled = true;
  }

  if (params.faireLink === "linked") {
    where.faireProductId = { not: null };
  } else if (params.faireLink === "unlinked") {
    where.faireProductId = null;
    where.faireEnabled = true;
  }

  if (params.orderchampLink === "linked") {
    where.orderchampProductId = { not: null };
  } else if (params.orderchampLink === "unlinked") {
    where.orderchampProductId = null;
    where.orderchampEnabled = true;
  }

  if (params.microstoreLink === "linked") {
    where.microstoreLastPushedAt = { not: null };
  } else if (params.microstoreLink === "unlinked") {
    where.microstoreLastPushedAt = null;
    where.microstoreEnabled = true;
  }

  if (params.syncRequired === "1") {
    // Le badge orange « Synchro nécessaire » ne s'affiche que si le produit
    // est effectivement lié à la marketplace (badge vert + orange).
    // On exclut donc les drapeaux orphelins (flag=true sans ID marketplace) —
    // sinon le filtre remonte des produits sans aucun badge orange visible.
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: [
          { pfsSyncRequired: true,      pfsProductId:          { not: null } },
          { ankorsSyncRequired: true,   ankorsProductId:       { not: null } },
          { efashionSyncRequired: true, efashionReferenceBase: { not: null } },
          { faireSyncRequired: true,    faireProductId:        { not: null } },
        ],
      },
    ];
  }

  if (params.translationStatus === "translated" && NON_DEFAULT_LOCALES.length > 0) {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      ...NON_DEFAULT_LOCALES.map((locale) => ({
        translations: { some: { locale } },
      })),
    ];
  } else if (params.translationStatus === "untranslated" && NON_DEFAULT_LOCALES.length > 0) {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      {
        OR: NON_DEFAULT_LOCALES.map((locale) => ({
          translations: { none: { locale } },
        })),
      },
    ];
  }

  // Filtres « Dernier export marketplace » — additifs (AND entre marketplaces).
  const exportClauses = [
    buildExportedAtClause("pfs", params.pfsExportedAt, now),
    buildExportedAtClause("efashion", params.efashionExportedAt, now),
    buildExportedAtClause("microstore", params.microstoreExportedAt, now),
    buildExportedAtClause("ankorstore", params.ankorstoreExportedAt, now),
    buildExportedAtClause("faire", params.faireExportedAt, now),
    buildExportedAtClause("orderchamp", params.orderchampExportedAt, now),
  ].filter((c): c is Prisma.ProductWhereInput => c !== null);
  if (exportClauses.length > 0) {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      ...exportClauses,
    ];
  }

  if (params.locked === "1") {
    where.locked = true;
  }

  // Filtre statut de vérification PFS. Toujours restreint aux produits liés
  // (pfsProductId non nul) — un produit non lié à PFS n'est pas dans le
  // périmètre du filtre, quelle que soit sa valeur de pfsCheckStatus.
  if (params.pfsVerify === "ok") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { pfsProductId: { not: null }, pfsCheckStatus: "ok" },
    ];
  } else if (params.pfsVerify === "diff") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { pfsProductId: { not: null }, pfsCheckStatus: "diff" },
    ];
  } else if (params.pfsVerify === "unchecked") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { pfsProductId: { not: null }, pfsCheckedAt: null },
    ];
  }

  if (params.hsCodeId === "__none__") {
    where.AND = [
      ...((where.AND as Prisma.ProductWhereInput[] | undefined) ?? []),
      { hsCodeId: null },
    ];
  } else if (params.hsCodeId) {
    where.hsCodeId = params.hsCodeId;
  }

  if (params.productIdsIn) {
    where.id = { ...(where.id as object | undefined), in: params.productIdsIn };
  }

  if (params.productIdsNotIn) {
    where.id = { ...(where.id as object | undefined), notIn: params.productIdsNotIn };
  }

  return where;
}

/**
 * Renvoie les productId où **au moins une variante de couleur** n'a aucune
 * image enregistrée. Le couple (productId, colorId) est la clé d'image dans
 * `ProductColorImage` — on cherche donc les ProductColor (avec colorId non
 * nul) pour lesquels aucune ligne image n'existe sur ce couple.
 *
 * Utilisé par la page `/admin/produits` pour le filtre « Variantes sans image ».
 * Le tenantId est OBLIGATOIRE en contexte requête (sinon fuite cross-tenant :
 * le scan raw SQL n'est pas passé par l'extension prisma-tenant-scope).
 */
export async function findProductIdsWithMissingVariantImages(
  prisma: Pick<PrismaClient, "$queryRaw">,
  tenantId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT DISTINCT pc.productId AS productId
    FROM ProductColor pc
    WHERE pc.colorId IS NOT NULL
      AND pc.tenantId = ${tenantId}
      AND NOT EXISTS (
        SELECT 1
        FROM ProductColorImage pci
        WHERE pci.productId = pc.productId
          AND pci.colorId = pc.colorId
      )
  `;
  return rows.map((r) => r.productId);
}

/**
 * Build the Prisma `orderBy` for the admin products list.
 *
 * Default: most recently created first.
 * `sort` (paramètre URL dédié) prend la priorité s'il vaut une des 4 options
 * de tri exposées à l'admin :
 *   - `createdDesc` / `createdAsc` : tri explicite par `createdAt`
 *   - `modifiedDesc` / `modifiedAsc` : tri par `updatedAt`
 *   - `importantFirst` : `important` desc, puis `createdAt` desc en tie-breaker
 *
 * Sinon on retombe sur le comportement historique via `refresh` :
 * - `dateDesc` / `dateAsc` : `lastRefreshedAt`, `nulls: "last"`, `createdAt` en tie-breaker
 * - `modifiedDesc` / `modifiedAsc` : `updatedAt`
 * - toute autre valeur (`""`, `"never"`, `"recent"`, `"refreshed"`) : `createdAt` desc
 *
 * `shortcuts` (raccourcis de la barre d'onglets) aligne le tri sur le raccourci
 * actif quand ni `sort` ni un tri porté par `refresh` ne sont posés — sans quoi
 * cliquer « Modifié récemment » filtrerait bien sur les 30 derniers jours mais
 * afficherait la liste par date de création, incohérent avec le tri « Modifié
 * le plus récent » du menu Trier.
 */
export function buildAdminProductsOrderBy(
  refresh?: string,
  sort?: string,
  shortcuts?: { createdRecent?: string; updatedRecent?: string },
): Prisma.ProductOrderByWithRelationInput[] {
  // `sort` a la priorité — valeurs reconnues, autres = ignoré (fallback refresh).
  if (sort === "createdDesc") return [{ createdAt: "desc" }];
  if (sort === "createdAsc")  return [{ createdAt: "asc" }];
  if (sort === "modifiedDesc") return [{ updatedAt: "desc" }];
  if (sort === "modifiedAsc")  return [{ updatedAt: "asc" }];
  if (sort === "importantFirst") return [{ important: "desc" }, { createdAt: "desc" }];
  // `custom` = ordre de saisie des références. Le vrai tri est appliqué en
  // mémoire après findMany via `sortProductsByQueryOrder` (Prisma ne supporte
  // pas ORDER BY FIELD nativement). On garde un ordre déterministe côté DB.
  if (sort === "custom") return [{ createdAt: "desc" }];

  if (refresh === "dateDesc") {
    return [
      { lastRefreshedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ];
  }
  if (refresh === "dateAsc") {
    return [
      { lastRefreshedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ];
  }
  if (refresh === "modifiedDesc") {
    return [{ updatedAt: "desc" }];
  }
  if (refresh === "modifiedAsc") {
    return [{ updatedAt: "asc" }];
  }

  if (shortcuts?.updatedRecent === "1") return [{ updatedAt: "desc" }];
  if (shortcuts?.createdRecent === "1") return [{ createdAt: "desc" }];

  return [{ createdAt: "desc" }];
}

/**
 * Réordonne une liste de produits par l'ordre d'apparition des termes de
 * recherche dans `q` (séparés par des virgules). Utilisé quand la cliente a
 * saisi plusieurs références et choisi le tri « Personnalisé » — on veut voir
 * les produits dans le même ordre que ses références.
 *
 * Ne fait rien si moins de 2 termes (le tri personnalisé n'a pas de sens sur
 * une seule référence). Retourne le tableau tel quel dans ce cas.
 *
 * Comparaison insensible à la casse. Pour chaque produit on prend l'index du
 * PREMIER terme qui matche (par référence exacte en mode exactRef, ou par
 * `reference startsWith` / `name contains` en mode fuzzy — miroir du WHERE).
 * Les produits non matchés (théoriquement aucun, ils viennent d'un WHERE
 * qui filtre déjà) sont mis à la fin.
 *
 * Tri stable : deux produits qui matchent le même terme conservent leur ordre
 * relatif d'entrée (qui vient de l'orderBy Prisma).
 */
export function sortProductsByQueryOrder<T extends { reference: string; name: string }>(
  products: T[],
  q: string | undefined,
  exactRef: boolean,
): T[] {
  if (!q) return products;
  const terms = q.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  if (terms.length < 2) return products;

  const upperTerms = terms.map((t) => t.toUpperCase());
  const lowerTerms = terms.map((t) => t.toLowerCase());

  const matchIndex = (p: T): number => {
    const refUpper = p.reference.toUpperCase();
    const nameLower = p.name.toLowerCase();
    for (let i = 0; i < upperTerms.length; i++) {
      if (exactRef) {
        if (refUpper === upperTerms[i]) return i;
      } else {
        if (refUpper.startsWith(upperTerms[i]) || nameLower.includes(lowerTerms[i])) return i;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };

  return products
    .map((p, i) => ({ p, i, k: matchIndex(p) }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i))
    .map((e) => e.p);
}
