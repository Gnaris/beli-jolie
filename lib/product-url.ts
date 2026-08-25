// Slug URL max ~80 chars — Google indexe volontiers jusqu'à ~100, mais on
// laisse de la marge pour le suffixe reference et un préfixe locale (/fr/).
const SLUG_MAX_LENGTH = 80;

// cuid Prisma par défaut : "c" + 24 caractères alphanumériques.
// Utilisé pour détecter les vieilles URLs `/produits/{cuid}` et rediriger 301
// vers le nouveau format `/produits/{slug}-{reference}`.
const CUID_REGEX = /^c[a-z0-9]{24}$/;

export function slugify(input: string): string {
  const normalized = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length <= SLUG_MAX_LENGTH) return normalized;
  return normalized.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

export function buildProductHandle(name: string, reference: string): string {
  const nameSlug = slugify(name);
  const refSlug = slugify(reference);
  if (!nameSlug) return refSlug;
  if (!refSlug) return nameSlug;
  return `${nameSlug}-${refSlug}`;
}

export interface ParsedProductHandle {
  reference: string | null;
  legacyCuid: string | null;
  /**
   * Toutes les références à tester en DB, dans l'ordre. Couvre le cas des
   * refs dupliquées par refresh (`A2251(2)`) que `slugify()` transforme en
   * `a2251-2` (tiret) ou `a2251_2` (underscore) — dans les deux cas
   * `lastIndexOf("-")` extrait juste `2` qui ne matche rien.
   */
  referenceCandidates: string[];
}

// Nombre de suffixes progressifs générés comme candidats. Couvre les refs
// jusqu'à 6 segments (`COUSSIN-BAGUE12-27` en fait 3), tout en évitant un
// `WHERE reference IN (...)` avec des dizaines d'éléments.
const MAX_REFERENCE_SEGMENTS = 6;

export function parseProductHandle(handle: string): ParsedProductHandle {
  let clean: string;
  try {
    clean = decodeURIComponent(handle).trim().toLowerCase();
  } catch {
    clean = handle.trim().toLowerCase();
  }
  if (!clean) return { reference: null, legacyCuid: null, referenceCandidates: [] };
  if (CUID_REGEX.test(clean)) {
    return { reference: null, legacyCuid: clean, referenceCandidates: [] };
  }

  // Génère progressivement des suffixes de plus en plus longs comme candidats
  // de référence. Couvre les refs multi-segments avec tirets internes
  // (`PRT-BRACELET33`, `PRT-OREILLE127`, `COUSSIN-BAGUE12-27`).
  const candidates: string[] = [];
  let pos = clean.length;
  for (let i = 0; i < MAX_REFERENCE_SEGMENTS; i++) {
    const dash = clean.lastIndexOf("-", pos - 1);
    if (dash === -1) {
      candidates.push(clean);
      break;
    }
    candidates.push(clean.slice(dash + 1));
    pos = dash;
  }

  const tail = candidates[0]!;

  // Ref `A2251(2)` slugifiée en `-a2251-2` : quand le tail est un chiffre
  // isolé, on tente aussi `{prevSeg}({tail})` en remontant d'un cran.
  if (/^\d+$/.test(tail) && clean.length > tail.length + 1) {
    const beforeTail = clean.slice(0, clean.length - tail.length - 1);
    const prevDash = beforeTail.lastIndexOf("-");
    const prevSeg = beforeTail.slice(prevDash + 1);
    if (prevSeg) candidates.push(`${prevSeg}(${tail})`);
  }

  // Format underscore `a2251_2` → `A2251(2)` (au cas où slugify évoluerait).
  const underscoreN = tail.match(/^(.+)_(\d+)$/);
  if (underscoreN) {
    candidates.push(`${underscoreN[1]}(${underscoreN[2]})`);
  }

  return { reference: tail, legacyCuid: null, referenceCandidates: candidates };
}
