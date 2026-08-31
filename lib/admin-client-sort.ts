/**
 * Tri de la liste des clients inscrits (admin › Gestion des clients › Inscrits).
 *
 * Deux familles de tri :
 *   - « colonne » (created / login / company) : trié + paginé directement par
 *     MySQL via `buildUserOrderBy()`.
 *   - « statistiques » (orders / spent) : la donnée vit dans la table Order, on
 *     agrège d'abord (groupBy) puis on ordonne les ids en mémoire via
 *     `sortClientIdsByStats()` avant de paginer.
 */

export type ClientSortKey = "created" | "orders" | "spent" | "login" | "company";
export type SortDir = "asc" | "desc";

export interface ClientOrderStats {
  /** Nombre de commandes non annulées */
  count: number;
  /** Montant total TTC des commandes non annulées, en euros */
  spent: number;
}

export const EMPTY_CLIENT_STATS: ClientOrderStats = { count: 0, spent: 0 };

interface SortOptionMeta {
  value: ClientSortKey;
  /** Libellé du critère dans le menu déroulant */
  label: string;
  /** Libellé du bouton de sens quand dir = "desc" */
  descLabel: string;
  /** Libellé du bouton de sens quand dir = "asc" */
  ascLabel: string;
  /** Sens appliqué par défaut quand la cliente choisit ce critère */
  defaultDir: SortDir;
}

export const CLIENT_SORT_OPTIONS: readonly SortOptionMeta[] = [
  {
    value: "created",
    label: "Date d'inscription",
    descLabel: "Plus récents d'abord",
    ascLabel: "Plus anciens d'abord",
    defaultDir: "desc",
  },
  {
    value: "orders",
    label: "Nombre de commandes",
    descLabel: "Du plus grand nombre",
    ascLabel: "Du plus petit nombre",
    defaultDir: "desc",
  },
  {
    value: "spent",
    label: "Montant total dépensé",
    descLabel: "Du plus gros montant",
    ascLabel: "Du plus petit montant",
    defaultDir: "desc",
  },
  {
    value: "login",
    label: "Dernière activité",
    descLabel: "Activité la plus récente",
    ascLabel: "Activité la plus ancienne",
    defaultDir: "desc",
  },
  {
    value: "company",
    label: "Société (alphabétique)",
    descLabel: "Z → A",
    ascLabel: "A → Z",
    defaultDir: "asc",
  },
] as const;

const SORT_KEYS = new Set<string>(CLIENT_SORT_OPTIONS.map((o) => o.value));

export const DEFAULT_CLIENT_SORT: ClientSortKey = "created";

export function parseClientSort(raw: string | undefined | null): ClientSortKey {
  return raw && SORT_KEYS.has(raw) ? (raw as ClientSortKey) : DEFAULT_CLIENT_SORT;
}

export function defaultDirFor(sort: ClientSortKey): SortDir {
  return CLIENT_SORT_OPTIONS.find((o) => o.value === sort)?.defaultDir ?? "desc";
}

export function parseSortDir(raw: string | undefined | null, sort: ClientSortKey): SortDir {
  if (raw === "asc" || raw === "desc") return raw;
  return defaultDirFor(sort);
}

export function sortOptionMeta(sort: ClientSortKey): SortOptionMeta {
  return CLIENT_SORT_OPTIONS.find((o) => o.value === sort) ?? CLIENT_SORT_OPTIONS[0];
}

/** Libellé humain du bouton croissant/décroissant pour le couple (critère, sens). */
export function dirLabel(sort: ClientSortKey, dir: SortDir): string {
  const meta = sortOptionMeta(sort);
  return dir === "desc" ? meta.descLabel : meta.ascLabel;
}

/** true = le tri a besoin des agrégats de la table Order. */
export function isStatsSort(sort: ClientSortKey): sort is "orders" | "spent" {
  return sort === "orders" || sort === "spent";
}

/**
 * `orderBy` Prisma pour les tris gérés directement par MySQL.
 * Note : MySQL classe NULL comme la plus petite valeur — les clients qui ne se
 * sont jamais connectés se retrouvent donc en tête en ordre croissant et en
 * queue en ordre décroissant, ce qui est le comportement attendu.
 *
 * « login » trie sur `lastSeenAt` (heartbeat toutes les 30s, mis à jour dès
 * qu'un client navigue sur le site), et non sur `lastLoginAt` qui ne bouge
 * qu'à un vrai login — sinon un client qui reste connecté et navigue tous
 * les jours n'apparaissait jamais en tête de « activité la plus récente ».
 */
export function buildUserOrderBy(
  sort: ClientSortKey,
  dir: SortDir,
): { createdAt: SortDir } | { lastSeenAt: SortDir } | { company: SortDir } {
  if (sort === "login") return { lastSeenAt: dir };
  if (sort === "company") return { company: dir };
  return { createdAt: dir };
}

/**
 * Ordonne des ids clients selon leurs stats de commandes.
 *
 * `ids` doit arriver pré-trié par un critère stable (date d'inscription
 * décroissante) : le tri JS étant stable, les ex æquo (souvent « 0 commande »)
 * gardent cet ordre secondaire.
 */
export function sortClientIdsByStats(
  ids: readonly string[],
  stats: ReadonlyMap<string, ClientOrderStats>,
  sort: "orders" | "spent",
  dir: SortDir,
): string[] {
  const valueOf = (id: string): number => {
    const s = stats.get(id);
    if (!s) return 0;
    return sort === "orders" ? s.count : s.spent;
  };

  return [...ids].sort((a, b) => {
    const diff = valueOf(b) - valueOf(a);
    return dir === "desc" ? diff : -diff;
  });
}

/** Formate un montant en euros pour l'affichage admin (sans centimes). */
export function formatSpent(amount: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}
