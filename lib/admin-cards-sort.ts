// Helpers purs pour le tri des fiches admin (/admin/clients?tab=fiches).
// Les 2 tris stats-based (CA, nb de commandes) ne peuvent pas être exprimés
// en SQL : la donnée vit dans 6 tables marketplace. On trie côté JS.

export type AdminCardsSort =
  | "created"
  | "order_desc"
  | "order_asc"
  | "amount_desc"
  | "amount_asc"
  | "count_desc"
  | "count_asc";

export const ADMIN_CARDS_SORT_VALUES: readonly AdminCardsSort[] = [
  "created",
  "order_desc",
  "order_asc",
  "amount_desc",
  "amount_asc",
  "count_desc",
  "count_asc",
] as const;

export function parseAdminCardsSort(raw: string | null | undefined): AdminCardsSort {
  return ADMIN_CARDS_SORT_VALUES.includes(raw as AdminCardsSort) ? (raw as AdminCardsSort) : "created";
}

export function isAdminCardStatsSort(sort: AdminCardsSort): boolean {
  return sort === "amount_desc" || sort === "amount_asc" || sort === "count_desc" || sort === "count_asc";
}

export type AdminCardOrderStats = { count: number; amount: number };

export const EMPTY_ADMIN_CARD_STATS: AdminCardOrderStats = { count: 0, amount: 0 };

/** Trie les IDs par stats (CA ou nb commandes). Les fiches sans stats sont considérées à 0. */
export function sortCardIdsByStats(
  ids: string[],
  stats: Map<string, AdminCardOrderStats>,
  sort: AdminCardsSort,
): string[] {
  const pick = (id: string) => stats.get(id) ?? EMPTY_ADMIN_CARD_STATS;
  const copy = [...ids];
  copy.sort((a, b) => {
    const sa = pick(a);
    const sb = pick(b);
    if (sort === "amount_desc") return sb.amount - sa.amount;
    if (sort === "amount_asc") return sa.amount - sb.amount;
    if (sort === "count_desc") return sb.count - sa.count;
    if (sort === "count_asc") return sa.count - sb.count;
    return 0;
  });
  return copy;
}
