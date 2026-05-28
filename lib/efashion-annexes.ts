/**
 * eFashion Paris — Référentiels (annexes) pour les sélecteurs admin de mapping.
 *
 * Charge depuis l'API eFashion les listes maîtres dont l'admin a besoin pour
 * mapper les bibliothèques locales (Color, Size, Category, Country, Season,
 * Composition) à leurs IDs eFashion.
 *
 * Cache via `unstable_cache` 60 min, tag "efashion-annexes" (révoqué à toute
 * modification de SiteConfig eFashion ou au pied levé via revalidateTag).
 */

import { unstable_cache } from "next/cache";

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGraphql } from "@/lib/efashion-client";
import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EfashionCategoryNode {
  id: number;
  label: string;
  /** Tous les ancêtres concaténés, pratique pour l'affichage : "Femme > Accessoires > Bijoux > Boucles d'oreilles". */
  path: string;
  parentId: number | null;
  topId: number | null;
  /** True si feuille (pas d'enfants) — seules les feuilles sont utilisables pour `id_categorie`. */
  isLeaf: boolean;
}

export interface EfashionProvenance {
  id: number;
  libelle: string;
}

export interface EfashionCollection {
  id: number;
  label: string;
}

export interface EfashionDeclinaison {
  id: number;
  titre: string;
  /** Toutes les tailles disponibles dans cette déclinaison sous forme `{field, value}`. */
  sizes: Array<{ field: string; value: string }>;
}

export interface EfashionColor {
  id: number;
  fr: string;
  en: string;
  /** Hex récupéré depuis `couleursByVendeur` (présent si la couleur est dans le
   * catalogue vendeur ; null sinon — la couleur faudra l'ajouter avec
   * `addCouleurToVendeur` avant utilisation). */
  hex: string | null;
  inVendorCatalog: boolean;
}

export interface EfashionPack {
  id: number;
  /** Label affichable (ex: "1", "Pack 12"). */
  label: string;
  /** Quantité numérique du pack (ex: 1, 12). */
  quantity: number;
}

export interface EfashionAnnexes {
  categories: EfashionCategoryNode[];
  provenances: EfashionProvenance[];
  collections: EfashionCollection[];
  declinaisons: EfashionDeclinaison[];
  colors: EfashionColor[];
  packs: EfashionPack[];
  /** Compositions pré-chargées (~190 items). L'autocomplete reste utilisable
   * pour la recherche au fil de la frappe, mais on n'est plus obligé de
   * dépendre du réseau pour montrer une liste. */
  compositions: Array<{ id: number; label: string }>;
  fetchedAt: string;
}

// ─── Helpers internes ──────────────────────────────────────────────────────

interface RawCategoryNode {
  id_categorie: number;
  label: string;
  id_parent_categorie: number | null;
  id_top_categorie: number | null;
  children?: RawCategoryNode[];
}

function flattenCategoriesTree(
  nodes: RawCategoryNode[],
  parentPath = "",
): EfashionCategoryNode[] {
  const out: EfashionCategoryNode[] = [];
  for (const node of nodes) {
    const path = parentPath ? `${parentPath} > ${node.label}` : node.label;
    const children = node.children ?? [];
    out.push({
      id: node.id_categorie,
      label: node.label,
      path,
      parentId: node.id_parent_categorie,
      topId: node.id_top_categorie,
      isLeaf: children.length === 0,
    });
    if (children.length > 0) {
      out.push(...flattenCategoriesTree(children, path));
    }
  }
  return out;
}

// ─── Fetcher unique basé sur get-reference-data ───────────────────────────
//
// `/shootings/get-reference-data` renvoie en 1 seul appel REST :
//   marques, categories, sousCategories, sousSousCategories, collections,
//   provenances, packs, declinaisons (avec `tailles` agrégé), couleurs (vendeur),
//   compositions (~190).
// → on remplace 5 queries GraphQL + N appels par déclinaison par 1 seul appel.

interface RawRefData {
  marques?: Array<{ id: number; label: string; value: number; defaut?: boolean }>;
  categories?: Array<{ id: number; label: string }>;
  sousCategories?: Array<{ id: number; label: string; parentId: string }>;
  sousSousCategories?: Array<{ id: number; label: string; parentId: string }>;
  collections?: Array<{ id: string | number; label: string }>;
  provenances?: Array<{ id: string | number; label: string }>;
  packs?: Array<{ id: number; label: string; value: string }>;
  declinaisons?: Array<{ id: number; label: string; value: number; tailles: string }>;
  compositions?: Array<{ id: number; libelle: string }>;
}

function buildCategoriesFromRef(ref: RawRefData): EfashionCategoryNode[] {
  const out: EfashionCategoryNode[] = [];
  const tops = ref.categories ?? [];
  const subs = ref.sousCategories ?? [];
  const subSubs = ref.sousSousCategories ?? [];

  const topById = new Map(tops.map((t) => [t.id, t]));
  const subById = new Map(subs.map((s) => [s.id, s]));

  for (const t of tops) {
    out.push({
      id: t.id,
      label: t.label,
      path: t.label,
      parentId: null,
      topId: t.id,
      isLeaf: !subs.some((s) => Number(s.parentId) === t.id),
    });
  }
  for (const s of subs) {
    const parentId = Number(s.parentId);
    const top = topById.get(parentId);
    const topLabel = top?.label ?? "?";
    out.push({
      id: s.id,
      label: s.label,
      path: `${topLabel} > ${s.label}`,
      parentId,
      topId: parentId,
      isLeaf: !subSubs.some((ss) => Number(ss.parentId) === s.id),
    });
  }
  for (const ss of subSubs) {
    const subParentId = Number(ss.parentId);
    const parent = subById.get(subParentId);
    const top = parent ? topById.get(Number(parent.parentId)) : undefined;
    const topLabel = top?.label ?? "?";
    const subLabel = parent?.label ?? "?";
    out.push({
      id: ss.id,
      label: ss.label,
      path: `${topLabel} > ${subLabel} > ${ss.label}`,
      parentId: subParentId,
      topId: top?.id ?? null,
      isLeaf: true,
    });
  }
  return out;
}

function buildDeclinaisonsFromRef(ref: RawRefData): EfashionDeclinaison[] {
  const raw = ref.declinaisons ?? [];
  return raw
    .map((d) => {
      // `tailles` est une chaîne CSV ("17,18,19") — chaque entrée correspond à
      // d{N}_FR dans l'ordre. On garde le mapping field<->value.
      const parts = (d.tailles ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const sizes = parts.map((value, idx) => ({
        field: `d${idx + 1}_FR`,
        value,
      }));
      return { id: d.id, titre: d.label, sizes };
    })
    .filter((d) => d.sizes.length > 0);
}

async function fetchMasterColorsWithHex(): Promise<EfashionColor[]> {
  // La master list (~milliers) n'est pas dans get-reference-data.
  // get-reference-data ne donne que les couleurs vendeur (~44).
  // → on fait 2 requêtes en parallèle.
  await ensureEfashionSession();
  const me = await import("@/lib/efashion-api").then((m) => m.efashionGetMe());

  const [masterRaw, vendorRaw] = await Promise.all([
    efashionGraphql<{ allCouleursDefaut: Array<{ id_couleur: string | number; couleur_FR: string; couleur_EN: string }> }>(
      `query GetAllCouleursDefaut {
        allCouleursDefaut { id_couleur couleur_FR couleur_EN }
      }`,
    ).catch(() => ({ allCouleursDefaut: [] })),
    efashionGraphql<{
      couleursByVendeur: Array<{ id_couleur: number; couleur_FR: string; couleur_EN: string; hexColor: string | null }>;
    }>(
      `query GetCouleursByVendeur {
        couleursByVendeur(id_vendeur: ${me.id_vendeur}) {
          id_couleur couleur_FR couleur_EN hexColor
        }
      }`,
    ).catch(() => ({ couleursByVendeur: [] })),
  ]);

  // Vendor list peut contenir des doublons — dédoublonnage en gardant le 1er hex non null.
  const vendorByIdHex = new Map<number, string | null>();
  for (const c of vendorRaw.couleursByVendeur ?? []) {
    if (!vendorByIdHex.has(c.id_couleur)) {
      vendorByIdHex.set(c.id_couleur, c.hexColor ?? null);
    } else if (vendorByIdHex.get(c.id_couleur) === null && c.hexColor) {
      vendorByIdHex.set(c.id_couleur, c.hexColor);
    }
  }

  return (masterRaw.allCouleursDefaut ?? []).map((c) => {
    const id = typeof c.id_couleur === "string" ? Number(c.id_couleur) : c.id_couleur;
    return {
      id,
      fr: c.couleur_FR,
      en: c.couleur_EN,
      hex: vendorByIdHex.get(id) ?? null,
      inVendorCatalog: vendorByIdHex.has(id),
    };
  });
}

// ─── Cache combiné (1 heure) ───────────────────────────────────────────────

async function loadAnnexesDirect(): Promise<EfashionAnnexes> {
  await ensureEfashionSession();

  // 2 appels en parallèle :
  //  1. /shootings/get-reference-data → tout en 1 (catégories 3-niveaux, collections,
  //     provenances, packs, déclinaisons avec tailles, compositions ~190)
  //  2. allCouleursDefaut + couleursByVendeur → liste master colors avec hex
  const [refData, colors] = await Promise.all([
    (async () => {
      try {
        const { efashionGetReferenceData } = await import("@/lib/efashion-shootings");
        return (await efashionGetReferenceData()) as unknown as RawRefData;
      } catch (err) {
        logger.warn("[eFashion annexes] get-reference-data failed", { error: err });
        return {} as RawRefData;
      }
    })(),
    fetchMasterColorsWithHex().catch((err) => {
      logger.warn("[eFashion annexes] colors failed", { error: err });
      return [];
    }),
  ]);

  return {
    categories: buildCategoriesFromRef(refData),
    provenances: (refData.provenances ?? []).map((p) => ({
      id: Number(p.id),
      libelle: p.label,
    })),
    collections: (refData.collections ?? []).map((c) => ({
      id: Number(c.id),
      label: c.label,
    })),
    declinaisons: buildDeclinaisonsFromRef(refData),
    colors,
    packs: (refData.packs ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      quantity: Number(p.value) || 1,
    })),
    compositions: (refData.compositions ?? []).map((c) => ({
      id: c.id,
      label: c.libelle,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

const cachedAnnexes = unstable_cache(loadAnnexesDirect, ["efashion-annexes"], {
  revalidate: 3600,
  tags: ["efashion-annexes"],
});

export async function getEfashionAnnexes(): Promise<EfashionAnnexes> {
  try {
    return await cachedAnnexes();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("incrementalCache") || msg.includes("unstable_cache")) {
      return await loadAnnexesDirect();
    }
    throw err;
  }
}

/**
 * Bypass complet du cache `unstable_cache` — relit directement chez eFashion.
 *
 * Utilisé avant de créer une déclinaison en doublon : si plusieurs produits
 * avec les mêmes tailles ont été synchronisés dans la même heure, le cache
 * de `getEfashionAnnexes` peut ignorer la déclinaison que le 1ᵉʳ produit
 * vient juste de créer. Ce helper garantit qu'on voit l'état frais avant
 * d'en créer une 2ᵉ identique.
 */
export async function getEfashionAnnexesFresh(): Promise<EfashionAnnexes> {
  return loadAnnexesDirect();
}

/**
 * Compositions : autocomplete uniquement (pas de liste pré-chargée).
 * Le caller (modal) appelle cette fonction au fil de la saisie.
 */
export async function searchEfashionCompositions(
  term: string,
): Promise<Array<{ id: number; label: string }>> {
  await ensureEfashionSession();
  if (term.trim().length === 0) return [];
  const { efashionGetCompositionAutocomplete } = await import("@/lib/efashion-shootings");
  return efashionGetCompositionAutocomplete(term);
}
