/**
 * Types + labels du système de mapping-impact — SANS dépendance à Prisma.
 * Importable depuis les client components sans polluer le bundle browser.
 */

export type MappingAttribute = "season" | "category" | "color" | "composition";
export type MappingMarketplace = "pfs" | "efashion" | "faire" | "orderchamp";

export interface MappingImpactedProduct {
  id: string;
  reference: string;
  name: string;
  firstImage: string | null;
}

export interface MappingImpactResult {
  count: number;
  products: MappingImpactedProduct[];
}

export interface MappingChangeSummary {
  attribute: MappingAttribute;
  marketplace: MappingMarketplace;
  localId: string;
  localName: string;
  count: number;
  oldValueLabel: string | null;
  newValueLabel: string | null;
  rollbackFields: Record<string, string | number | null>;
}

export function marketplaceLabel(mp: MappingMarketplace): string {
  if (mp === "pfs") return "Paris Fashion Shop";
  if (mp === "efashion") return "eFashion";
  if (mp === "faire") return "Faire";
  return "Orderchamp";
}
