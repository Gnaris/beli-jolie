/**
 * Liste des valeurs de l'enum GraphQL `FilterMaterialValue` d'Orderchamp
 * (bijoux + matériaux textiles couramment vendus en B2B européen).
 *
 * ⚠️ Source : introspection GraphQL OC + doc `filterMaterial` (voir
 * docs/orderchamp-integration.md). Si un matériau manque, il suffit de
 * l'ajouter ici en respectant EXACTEMENT le nom de l'enum côté OC — un
 * matériau inconnu est refusé côté OC (mutation renvoie `userErrors`).
 *
 * Utilisé uniquement côté admin (sélecteur `/admin/compositions`) — le payload
 * publish (`lib/orderchamp-publish.ts`) envoie la valeur brute stockée en BDD.
 */

export interface OrderchampMaterialOption {
  /** Valeur enum GraphQL — stockée en BDD (`Composition.orderchampMaterialCode`). */
  value: string;
  /** Libellé français affiché dans le sélecteur admin. */
  labelFr: string;
  /** Famille utilisée pour grouper la liste (métal, textile, pierre…). */
  group: string;
}

export const ORDERCHAMP_MATERIALS: OrderchampMaterialOption[] = [
  // ── Métaux nus ─────────────────────────────────────────────────────
  { value: "STAINLESS_STEEL", labelFr: "Acier inoxydable", group: "Métaux" },
  { value: "BRASS", labelFr: "Laiton", group: "Métaux" },
  { value: "COPPER", labelFr: "Cuivre", group: "Métaux" },
  { value: "ALUMINUM", labelFr: "Aluminium", group: "Métaux" },
  { value: "IRON", labelFr: "Fer", group: "Métaux" },
  { value: "STERLING_SILVER", labelFr: "Argent 925", group: "Métaux" },
  { value: "SILVER", labelFr: "Argent", group: "Métaux" },
  { value: "GOLD", labelFr: "Or", group: "Métaux" },
  { value: "PLATINUM", labelFr: "Platine", group: "Métaux" },
  { value: "TITANIUM", labelFr: "Titane", group: "Métaux" },
  { value: "ZINC_ALLOY", labelFr: "Alliage de zinc", group: "Métaux" },
  { value: "PEWTER", labelFr: "Étain", group: "Métaux" },

  // ── Métaux plaqués / doré ──────────────────────────────────────────
  { value: "GOLD_PLATED", labelFr: "Plaqué or", group: "Plaqués" },
  { value: "ROSE_GOLD_PLATED", labelFr: "Plaqué or rose", group: "Plaqués" },
  { value: "SILVER_PLATED", labelFr: "Plaqué argent", group: "Plaqués" },
  { value: "RHODIUM_PLATED", labelFr: "Plaqué rhodium", group: "Plaqués" },

  // ── Pierres & perles ───────────────────────────────────────────────
  { value: "GENUINE_PEARLS", labelFr: "Perles naturelles", group: "Pierres & perles" },
  { value: "ARTIFICIAL_PEARLS", labelFr: "Perles synthétiques", group: "Pierres & perles" },
  { value: "ZIRCONIA", labelFr: "Zircon", group: "Pierres & perles" },
  { value: "DIAMOND", labelFr: "Diamant", group: "Pierres & perles" },
  { value: "GEMSTONE", labelFr: "Pierre précieuse", group: "Pierres & perles" },
  { value: "CRYSTAL", labelFr: "Cristal", group: "Pierres & perles" },
  { value: "GLASS", labelFr: "Verre", group: "Pierres & perles" },

  // ── Matériaux composites / plastiques ──────────────────────────────
  { value: "ENAMEL", labelFr: "Émail", group: "Composites" },
  { value: "RESIN", labelFr: "Résine", group: "Composites" },
  { value: "ACRYLIC", labelFr: "Acrylique", group: "Composites" },
  { value: "PLASTIC", labelFr: "Plastique", group: "Composites" },
  { value: "POLYMER", labelFr: "Polymère", group: "Composites" },
  { value: "SILICONE", labelFr: "Silicone", group: "Composites" },
  { value: "RUBBER", labelFr: "Caoutchouc", group: "Composites" },
  { value: "CERAMIC", labelFr: "Céramique", group: "Composites" },

  // ── Naturels / textiles ────────────────────────────────────────────
  { value: "WOOD", labelFr: "Bois", group: "Naturels" },
  { value: "LEATHER", labelFr: "Cuir", group: "Naturels" },
  { value: "FABRIC", labelFr: "Tissu", group: "Naturels" },
  { value: "COTTON", labelFr: "Coton", group: "Naturels" },
  { value: "LINEN", labelFr: "Lin", group: "Naturels" },
  { value: "SILK", labelFr: "Soie", group: "Naturels" },
  { value: "WOOL", labelFr: "Laine", group: "Naturels" },
];

export function findOrderchampMaterial(value: string | null): OrderchampMaterialOption | null {
  if (!value) return null;
  return ORDERCHAMP_MATERIALS.find((m) => m.value === value) ?? null;
}
