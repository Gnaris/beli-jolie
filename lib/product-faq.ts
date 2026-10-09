/**
 * « Foire aux informations » (FAI) produit.
 *
 * - **Défauts par boutique** : SiteConfig[`product_faq_defaults`] = JSON
 *   stringifié d'un `ProductFaqDefault[]`. Chaque entrée a un `id` stable
 *   généré au moment de l'ajout — c'est cet `id` qui sert à matcher les
 *   surcharges produit.
 * - **Surcharges par produit** : `Product.faqOverrides` = JSON d'un objet
 *   `{ [defaultItemId]: texteCustom }`. Clé manquante ou valeur vide (après
 *   trim) = le produit affiche le texte par défaut. Les clés orphelines
 *   (rubrique supprimée des défauts) sont ignorées côté lecture.
 */

export interface ProductFaqDefault {
  id: string;
  title: string;
  body: string;
}

export interface ResolvedFaqItem {
  id: string;
  title: string;
  body: string;
  /** true = texte custom produit, false = texte par défaut boutique */
  isCustom: boolean;
}

export type ProductFaqOverrides = Record<string, string>;

/**
 * Normalise la valeur brute lue dans SiteConfig vers un tableau typé.
 * Tolère : null, chaîne vide, JSON corrompu → tableau vide.
 */
export function parseProductFaqDefaults(raw: unknown): ProductFaqDefault[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: ProductFaqDefault[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const title = typeof o.title === "string" ? o.title : "";
    const body = typeof o.body === "string" ? o.body : "";
    if (!id) continue;
    out.push({ id, title, body });
  }
  return out;
}

/**
 * Normalise la valeur brute lue sur Product.faqOverrides vers un objet typé.
 */
export function parseProductFaqOverrides(raw: unknown): ProductFaqOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ProductFaqOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

/**
 * Fusionne défauts boutique + surcharges produit en liste prête à afficher.
 * Ordre = ordre des défauts. Surcharge non vide (après trim) remplace le
 * texte par défaut. Les clés orphelines dans `overrides` sont silencieusement
 * ignorées (rubrique supprimée côté paramètres).
 */
export function resolveProductFaq(
  defaults: ProductFaqDefault[],
  overrides: ProductFaqOverrides,
): ResolvedFaqItem[] {
  return defaults.map((def) => {
    const custom = overrides[def.id];
    const useCustom = typeof custom === "string" && custom.trim().length > 0;
    return {
      id: def.id,
      title: def.title,
      body: useCustom ? custom : def.body,
      isCustom: useCustom,
    };
  });
}

/**
 * Génère un id stable court (12 chars hex) pour une nouvelle rubrique.
 * Pas de dépendance externe — `crypto.randomUUID()` dispo en Node 20 +
 * navigateurs modernes.
 */
export function generateFaqItemId(): string {
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ??
    Math.random().toString(36).slice(2, 14)
  );
}

export const PRODUCT_FAQ_DEFAULTS_KEY = "product_faq_defaults";
