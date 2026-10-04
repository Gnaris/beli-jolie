export function normalizePriceInput(raw: string): string {
  return raw.trim().replace(",", ".");
}

export function buildPriceFilterHref(
  preserveParams: Record<string, string | undefined>,
  nextMin: string,
  nextMax: string,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preserveParams)) {
    if (value) params.set(key, value);
  }
  if (nextMin) params.set("minPrice", nextMin);
  if (nextMax) params.set("maxPrice", nextMax);
  const qs = params.toString();
  return `/produits${qs ? `?${qs}` : ""}`;
}
