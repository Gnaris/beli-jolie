import { normalizeForCompare } from "@/lib/text-normalize";

/**
 * Dictionnaire d'alias couleur : synonymes marketplace fusionnés sous un nom
 * canonique. Clés + valeurs normalisées (lowercase, sans accents). Pensé pour
 * être enrichi au fil des cas remontés par la cliente.
 *
 * Exemple : si Ankor libelle "Marine" et eFashion "Bleu marine", les deux
 * pastilles du top produit se fondent sous "bleu marine".
 */
const COLOR_ALIASES: Record<string, string> = {
  marine: "bleu marine",
  "bleu nuit": "bleu marine",
  navy: "bleu marine",
};

const SIZE_TOKENS = new Set([
  "taille unique",
  "taille u",
  "one size",
  "one-size",
  "onesize",
  "tu",
  "os",
]);

const SEPARATOR_REGEX = /\s*[·,\-\/|]\s*/;

function stripSizeTokens(normalized: string): string {
  const parts = normalized.split(SEPARATOR_REGEX).map((p) => p.trim());
  const kept = parts.filter((p) => p && !SIZE_TOKENS.has(p));
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Clé canonique pour regrouper les couleurs cross-marketplace.
 * Retourne null si le label ne contient rien d'exploitable (vide, uniquement
 * tokens taille).
 */
export function canonicalColorKey(label: string | null | undefined): string | null {
  const normalized = normalizeForCompare(label);
  if (!normalized) return null;
  const withoutSize = stripSizeTokens(normalized);
  if (!withoutSize) return null;
  return COLOR_ALIASES[withoutSize] ?? withoutSize;
}

/**
 * Entre plusieurs libellés qui partagent la même clé canon, choisit le plus
 * propre pour affichage : préfère celui sans séparateur, le plus court en
 * secours. Retourne null si aucun label exploitable.
 */
export function pickDisplayColorLabel(
  labels: Iterable<string | null | undefined>,
): string | null {
  const cleaned: string[] = [];
  for (const l of labels) {
    const trimmed = l?.trim();
    if (trimmed) cleaned.push(trimmed);
  }
  if (cleaned.length === 0) return null;
  cleaned.sort((a, b) => {
    const aSep = SEPARATOR_REGEX.test(a) ? 1 : 0;
    const bSep = SEPARATOR_REGEX.test(b) ? 1 : 0;
    if (aSep !== bSep) return aSep - bSep;
    return a.length - b.length;
  });
  return cleaned[0];
}
