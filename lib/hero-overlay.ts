export type HeroOverlayType = "solid" | "linear" | "radial";
export type HeroOverlayDirection = "left" | "right" | "top" | "bottom" | "diagonal";

export interface HeroOverlaySettings {
  type: HeroOverlayType;
  direction: HeroOverlayDirection;
  color: string;
  opacity: number;
}

export const DEFAULT_HERO_OVERLAY: HeroOverlaySettings = {
  type: "linear",
  direction: "left",
  color: "#0f0f0f",
  opacity: 90,
};

function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

export function parseHeroOverlay(raw: {
  type?: string | null;
  direction?: string | null;
  color?: string | null;
  opacity?: string | null;
}): HeroOverlaySettings {
  const type = (["solid", "linear", "radial"] as const).includes(raw.type as HeroOverlayType)
    ? (raw.type as HeroOverlayType)
    : DEFAULT_HERO_OVERLAY.type;
  const direction = (["left", "right", "top", "bottom", "diagonal"] as const).includes(
    raw.direction as HeroOverlayDirection,
  )
    ? (raw.direction as HeroOverlayDirection)
    : DEFAULT_HERO_OVERLAY.direction;
  const color = raw.color && isHex(raw.color) ? raw.color.toLowerCase() : DEFAULT_HERO_OVERLAY.color;
  const n = Number(raw.opacity);
  const opacity = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_HERO_OVERLAY.opacity;
  return { type, direction, color, opacity };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

const LINEAR_ANGLE: Record<HeroOverlayDirection, string> = {
  left: "to right",
  right: "to left",
  top: "to bottom",
  bottom: "to top",
  diagonal: "to bottom right",
};

/**
 * Retourne la valeur CSS à poser sur `background` (ou `backgroundImage` pour les
 * dégradés). Renvoyée telle quelle — le consommateur pose la div `absolute
 * inset-0` par-dessus l'image de fond.
 */
export function heroOverlayBackground(s: HeroOverlaySettings): string {
  const a = s.opacity / 100;
  if (s.type === "solid") {
    return rgba(s.color, a);
  }
  if (s.type === "radial") {
    // Vignette : bords sombres, centre transparent. Utile quand la photo est
    // déjà lisible au centre mais qu'on veut cadrer.
    return `radial-gradient(circle at center, transparent 0%, ${rgba(s.color, a)} 100%)`;
  }
  // linear : commence coloré du côté choisi, se fond vers transparent.
  const angle = LINEAR_ANGLE[s.direction];
  return `linear-gradient(${angle}, ${rgba(s.color, a)} 0%, ${rgba(s.color, a * 0.9)} 45%, transparent 100%)`;
}
