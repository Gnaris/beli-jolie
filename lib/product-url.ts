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
}

export function parseProductHandle(handle: string): ParsedProductHandle {
  let clean: string;
  try {
    clean = decodeURIComponent(handle).trim().toLowerCase();
  } catch {
    clean = handle.trim().toLowerCase();
  }
  if (!clean) return { reference: null, legacyCuid: null };
  if (CUID_REGEX.test(clean)) {
    return { reference: null, legacyCuid: clean };
  }
  const lastDash = clean.lastIndexOf("-");
  if (lastDash === -1) {
    return { reference: clean, legacyCuid: null };
  }
  return { reference: clean.slice(lastDash + 1), legacyCuid: null };
}
