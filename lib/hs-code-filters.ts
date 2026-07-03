export type HsCodeForFilters = {
  id: string;
  code: string;
  label: string;
  productCount: number;
};

export type HsCodeFilterKey = "unused" | "lowUsage";

export function matchesSearch(item: HsCodeForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.code.toLowerCase().includes(q)) return true;
  if (item.label.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesFilters(
  item: HsCodeForFilters,
  active: Set<HsCodeFilterKey>,
): boolean {
  if (active.size === 0) return true;
  if (active.has("unused") && item.productCount > 0) return false;
  if (active.has("lowUsage") && (item.productCount === 0 || item.productCount >= 10)) return false;
  return true;
}

export function countMissing(list: HsCodeForFilters[], key: HsCodeFilterKey): number {
  return list.filter((s) => matchesFilters(s, new Set([key]))).length;
}
