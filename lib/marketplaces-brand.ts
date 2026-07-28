/**
 * Identité visuelle de chaque marketplace : couleurs, dégradés, étiquettes.
 * Utilisé par la page Paramètres > Marketplaces (cockpit) pour donner sa
 * personnalité à chaque carte.
 */

export type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire" | "microstore";

export interface MarketplaceBrand {
  key: MarketplaceKey;
  name: string;
  tagline: string;
  /** Couleur principale (hex) — utilisée pour le header de la carte */
  primary: string;
  /** Couleur secondaire pour le dégradé */
  secondary: string;
  /** Couleur du texte sur le dégradé (clair ou foncé) */
  onPrimary: string;
  /** Couleur de remplissage subtile pour les tuiles KPI (rgba ultra léger) */
  tint: string;
  /** Initiale ou monogramme affiché dans le logo carré */
  monogram: string;
}

export const MARKETPLACES_BRAND: Record<MarketplaceKey, MarketplaceBrand> = {
  pfs: {
    key: "pfs",
    name: "Paris Fashion Shops",
    tagline: "Marketplace mode B2B",
    primary: "#0F0F10",
    secondary: "#2A2A2D",
    onPrimary: "#F5E9C7",
    tint: "rgba(15, 15, 16, 0.04)",
    monogram: "PFS",
  },
  ankorstore: {
    key: "ankorstore",
    name: "Ankorstore",
    tagline: "Concept stores européens",
    primary: "#0E7C66",
    secondary: "#1AB58A",
    onPrimary: "#FFFFFF",
    tint: "rgba(14, 124, 102, 0.06)",
    monogram: "A",
  },
  faire: {
    key: "faire",
    name: "Faire",
    tagline: "Marketplace B2B internationale",
    primary: "#1E1E1E",
    secondary: "#FF6B5C",
    onPrimary: "#FFFFFF",
    tint: "rgba(255, 107, 92, 0.06)",
    monogram: "F",
  },
  efashion: {
    key: "efashion",
    name: "eFashion Paris",
    tagline: "Grossiste mode Paris",
    primary: "#5B1A3D",
    secondary: "#A03A6E",
    onPrimary: "#FFFFFF",
    tint: "rgba(91, 26, 61, 0.05)",
    monogram: "eF",
  },
  microstore: {
    key: "microstore",
    name: "Microstore",
    tagline: "Synchro directe · stock temps réel",
    primary: "#0891b2",
    secondary: "#22d3ee",
    onPrimary: "#FFFFFF",
    tint: "rgba(8, 145, 178, 0.05)",
    monogram: "M",
  },
};

/** Helper pour récupérer un dégradé CSS prêt à l'emploi */
export function brandGradient(brand: MarketplaceBrand): string {
  return `linear-gradient(135deg, ${brand.primary} 0%, ${brand.secondary} 100%)`;
}
