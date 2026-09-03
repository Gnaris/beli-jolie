/**
 * Parseur/sérialiseur CSS gradient utilisé par GradientBuilder.
 *
 * Grammaire réduite volontairement — on ne cherche pas à supporter toutes les
 * fantaisies CSS, juste les cas produits par notre UI :
 *
 *   linear-gradient(<angle>deg, <color> <pos>%, <color> <pos>%, …)
 *   radial-gradient(<color> <pos>%, <color> <pos>%, …)
 *   conic-gradient(from <angle>deg, <color> <pos>%, <color> <pos>%, …)
 *
 * Les positions sont optionnelles ; on les remplit uniformément si absentes.
 *
 * Pur (0 dépendance) — safe pour bundle client.
 */

export type GradientType = "linear" | "radial" | "conic";

export interface GradientStop {
  color: string;   // hex #rrggbb ou #rgb
  position: number; // 0-100
}

export interface ParsedGradient {
  type: GradientType;
  angle: number;   // deg, pour linear et conic (ignoré pour radial)
  stops: GradientStop[];
}

export const DEFAULT_GRADIENT: ParsedGradient = {
  type: "linear",
  angle: 135,
  stops: [
    { color: "#0f172a", position: 0 },
    { color: "#334155", position: 100 },
  ],
};

/** Détecte si une chaîne ressemble à un gradient CSS. */
export function isGradientString(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^(linear|radial|conic)-gradient\s*\(/i.test(v.trim());
}

/** Parse une chaîne CSS gradient. Retourne le défaut si parsing échoue. */
export function parseGradient(css: string): ParsedGradient {
  if (!css || !isGradientString(css)) return DEFAULT_GRADIENT;
  const raw = css.trim();

  const typeMatch = raw.match(/^(linear|radial|conic)-gradient\s*\(([\s\S]+)\)\s*$/i);
  if (!typeMatch) return DEFAULT_GRADIENT;
  const type = typeMatch[1].toLowerCase() as GradientType;
  const inside = typeMatch[2];

  // Découpage par virgule mais en respectant les parenthèses (ex: rgba(0,0,0,1))
  const parts = splitTopLevelCommas(inside).map((p) => p.trim()).filter(Boolean);

  let angle = type === "linear" ? 90 : 0;
  let stopStrings = parts;

  if (type === "linear") {
    // Optionnel : première part = angle "135deg" ou direction "to right"
    if (/^\d+(\.\d+)?deg$/i.test(parts[0]) || /^to\s+/i.test(parts[0])) {
      angle = parseAngleOrDirection(parts[0]);
      stopStrings = parts.slice(1);
    }
  } else if (type === "conic") {
    // Optionnel : "from <angle>deg" ou "from <angle>deg at <pos>"
    if (/^from\s+/i.test(parts[0])) {
      const m = parts[0].match(/from\s+(\d+(?:\.\d+)?)deg/i);
      if (m) angle = Number(m[1]);
      stopStrings = parts.slice(1);
    }
  }

  const stops = stopStrings.map((s, i) => parseStop(s, i, stopStrings.length));
  if (stops.length < 2) return DEFAULT_GRADIENT;

  return { type, angle, stops };
}

/** Sérialise un ParsedGradient en chaîne CSS. */
export function serializeGradient(g: ParsedGradient): string {
  const stops = [...g.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.color} ${clamp(Math.round(s.position), 0, 100)}%`)
    .join(", ");
  const angle = clamp(Math.round(g.angle), 0, 360);
  if (g.type === "linear") return `linear-gradient(${angle}deg, ${stops})`;
  if (g.type === "conic") return `conic-gradient(from ${angle}deg, ${stops})`;
  return `radial-gradient(${stops})`;
}

/* ─────────────────────────────────────────────
   Utilitaires internes
   ───────────────────────────────────────────── */

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function parseAngleOrDirection(v: string): number {
  const trimmed = v.trim().toLowerCase();
  const degMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (degMatch) return normalizeAngle(Number(degMatch[1]));
  // Directions courantes → degrés (CSS : 0deg = to top)
  if (trimmed === "to top") return 0;
  if (trimmed === "to right") return 90;
  if (trimmed === "to bottom") return 180;
  if (trimmed === "to left") return 270;
  if (trimmed === "to top right" || trimmed === "to right top") return 45;
  if (trimmed === "to bottom right" || trimmed === "to right bottom") return 135;
  if (trimmed === "to bottom left" || trimmed === "to left bottom") return 225;
  if (trimmed === "to top left" || trimmed === "to left top") return 315;
  return 90;
}

function parseStop(s: string, index: number, total: number): GradientStop {
  // format attendu : "#rrggbb <pos>%" ou "rgb(...) <pos>%" ou juste "#rrggbb"
  const trimmed = s.trim();
  // Extraction du dernier token "<n>%" s'il existe
  const posMatch = trimmed.match(/(-?\d+(?:\.\d+)?)%\s*$/);
  const position = posMatch
    ? Number(posMatch[1])
    : (total <= 1 ? 0 : (index * 100) / (total - 1));
  const color = (posMatch ? trimmed.slice(0, posMatch.index).trim() : trimmed) || "#000000";
  return { color: normalizeColor(color), position: clamp(position, 0, 100) };
}

function normalizeColor(c: string): string {
  const trimmed = c.trim();
  // Accepte hex #rgb, #rrggbb, #rrggbbaa
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  // Fallback : couleur inconnue → noir (le parser tolérant vaut mieux qu'un crash UI)
  return "#000000";
}

function normalizeAngle(a: number): number {
  const mod = ((a % 360) + 360) % 360;
  return mod;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
