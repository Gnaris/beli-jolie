export type SizeForFilters = {
  id: string;
  name: string;
  pfsSizeRef: string | null;
  variantCount: number;
};

export type SizeFilterKey = "missingPfs" | "unused";

export function matchesSearch(size: SizeForFilters, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (size.name.toLowerCase().includes(q)) return true;
  if (size.pfsSizeRef && size.pfsSizeRef.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesFilters(size: SizeForFilters, active: Set<SizeFilterKey>): boolean {
  if (active.size === 0) return true;
  if (active.has("missingPfs") && size.pfsSizeRef && size.pfsSizeRef.trim() !== "") return false;
  if (active.has("unused") && size.variantCount > 0) return false;
  return true;
}

export function countMissing(list: SizeForFilters[], key: SizeFilterKey): number {
  return list.filter((s) => matchesFilters(s, new Set([key]))).length;
}
