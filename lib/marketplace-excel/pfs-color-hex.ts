/**
 * Manual hex mapping for the most common French color names that appear in
 * the PFS "ANNEXE Couleurs" list. Used to auto-populate the color picker
 * when the admin accepts a PFS suggestion in the quick-create modal.
 *
 * Not exhaustive on purpose — only the color terms where a single canonical
 * hex is obvious. Ambiguous entries ("Autre", "Animaux", "Abstrait",
 * "Bicolore", pattern names like "CARREAUX"…) are intentionally excluded so
 * the admin keeps control of the swatch.
 *
 * Keys are normalised with the same `normalizePfsQuery` helper so callers
 * can look up using the raw PFS reference (case/diacritics preserved).
 */

import { normalizePfsQuery } from "@/components/admin/pfs/PfsSuggestions";

const RAW: Record<string, string> = {
  // Neutres
  "Blanc":        "#FFFFFF",
  "Crême":        "#FFF8E7",
  "Crème":        "#FFF8E7",
  "Ivoire":       "#FFFFF0",
  "Beige":        "#F5F5DC",
  "Écru":         "#F4F0EC",
  "Nude":         "#E3BC9A",
  "Blush":        "#E8B4B8",
  "Gris":         "#808080",
  "Gris Clair":   "#BFBFBF",
  "Gris Foncé":   "#4F4F4F",
  "Anthracite":   "#2E2E2E",
  "Carbone":      "#1C1C1C",
  "Noir":         "#000000",
  "Taupe":        "#8B7D6B",
  "Kaki":         "#7C834A",
  "Khaki":        "#7C834A",

  // Rouges / Rose
  "Rouge":        "#E53935",
  "Rouge Foncé":  "#8B0000",
  "Bordeaux":     "#7B1E26",
  "Brique":       "#A0522D",
  "Carmin":       "#960018",
  "Corail":       "#FF6F61",
  "Rose":         "#F48FB1",
  "Rose Clair":   "#F8BBD0",
  "Rose Foncé":   "#C2185B",
  "Rose Pâle":    "#F8BBD0",
  "Fuchsia":      "#FF1493",
  "Framboise":    "#C72C48",
  "Magenta":      "#FF00FF",

  // Orange / Jaune / Or
  "Orange":       "#FF8C00",
  "Abricot":      "#FBCEB1",
  "Pêche":        "#FFCBA4",
  "Corail Vif":   "#FF7F50",
  "Jaune":        "#FFD700",
  "Jaune Pâle":   "#FFF59D",
  "Jaune Moutarde": "#C9A227",
  "Moutarde":     "#C9A227",
  "Or":           "#D4AF37",
  "Doré":         "#D4AF37",
  "Or Rose":      "#E79F9A",
  "Champagne":    "#F7E7CE",
  "Caramel":      "#C68E17",
  "Camel":        "#C19A6B",
  "Cognac":       "#9A463D",
  "Chocolat":     "#3D1F0F",
  "Marron":       "#5D3A1A",
  "Brun":         "#5D3A1A",
  "Brun Foncé":   "#3B1F0F",
  "Terracotta":   "#B86B4B",

  // Verts
  "Vert":         "#2E8B57",
  "Vert Clair":   "#90EE90",
  "Vert Foncé":   "#006400",
  "Vert d'Eau":   "#A0DFD3",
  "Céladon":      "#ACE1AF",
  "Vert Pomme":   "#8DB600",
  "Vert Olive":   "#708238",
  "Olive":        "#708238",
  "Vert Sapin":   "#0A3D2C",
  "Émeraude":     "#50C878",
  "Menthe":       "#98FF98",
  "Menthe Clair": "#C6F4D6",

  // Bleus
  "Bleu":         "#1E90FF",
  "Bleu Clair":   "#A7D8FF",
  "Bleu Ciel":    "#87CEEB",
  "Bleu Foncé":   "#00008B",
  "Bleu Marine":  "#12274D",
  "Marine":       "#12274D",
  "Bleu Roi":     "#002366",
  "Bleu Océan":   "#1F75FE",
  "Bleu Pétrole": "#1B4D4D",
  "Bleu Irisé":   "#4B92DB",
  "Turquoise":    "#30D5C8",
  "Cyan":         "#00BCD4",
  "Indigo":       "#4B0082",

  // Violets
  "Violet":       "#7F1FA5",
  "Violet Clair": "#D1B3E5",
  "Pourpre":      "#660066",
  "Lavande":      "#B497BD",
  "Lilas":        "#C8A2C8",
  "Prune":        "#6A2E5A",
  "Mauve":        "#B784A7",
  "Aubergine":    "#430D4B",

  // Métalliques / pierre
  "Argent":       "#C0C0C0",
  "Argenté":      "#C0C0C0",
  "Acier":        "#8A9299",
  "Bronze":       "#CD7F32",
  "Cuivre":       "#B87333",
  "Étain":        "#8B8E97",
  "Platine":      "#E5E4E2",
  "Nacré":        "#F5F3F0",
  "Perle":        "#EEE8E0",
};

const LOOKUP: Record<string, string> = {};
for (const [name, hex] of Object.entries(RAW)) {
  LOOKUP[normalizePfsQuery(name)] = hex;
}

/**
 * Look up a PFS color name and return its hex code, or null if unknown.
 * The lookup is case- and diacritics-insensitive.
 */
export function hexForPfsColor(pfsColor: string | null | undefined): string | null {
  if (!pfsColor) return null;
  return LOOKUP[normalizePfsQuery(pfsColor)] ?? null;
}
