"use server";

/**
 * Faire — Server actions pour la liaison manuelle.
 *
 * Permet de relier manuellement un produit BJ à un produit existant côté Faire
 * (sans le republier). Flux UI (style PFS) :
 *   1. previewFaireMatchBySku(productId, sku?) → cherche `GET /products?sku=`,
 *      retourne les variantes Faire + couleurs BJ + suggestion mapping.
 *   2. linkFaireProductManually(productId, faireProductId, links[]) → écrit
 *      faireProductId + chaque ProductColor.faireVariantId, puis lance une
 *      sync incrémentale best-effort pour aligner stock/prix.
 *   3. removeFaireMatch(productId) → délie tout côté BDD (Faire reste inchangé).
 *
 * Note : Faire ne liste que les produits PUBLISHED. Les DRAFT ne sont pas
 * retrouvables via `?sku=` ; un produit en brouillon côté Faire devra être
 * rattrapé via `Publier` (POST) plutôt que `Lier`.
 */

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { faireFetch, faireGetProduct, type FaireProduct } from "@/lib/faire-api";
import { sortFaireCandidates, skuMatchesQuery } from "@/lib/faire-search-rank";
import { buildFaireVariantSkus } from "@/lib/faire-sku";
import { getFaireTaxonomy, type FaireTaxonomyType } from "@/lib/faire-taxonomy";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/**
 * Renvoie la taxonomie Faire (cache 24h, tag `faire-taxonomy`) pour le
 * sélecteur autocomplete côté UI catégories.
 */
export async function getFaireTaxonomyOptions(): Promise<FaireTaxonomyType[]> {
  await requireAdmin();
  try {
    return await getFaireTaxonomy();
  } catch (err) {
    logger.warn("[Faire] getFaireTaxonomyOptions failed", { error: String(err) });
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Types preview / link
// ────────────────────────────────────────────────────────────────────────────

export interface FaireLinkCandidate {
  /** ID Faire de la variante ("po_xxx"). */
  faireVariantId: string;
  /** SKU Faire de la variante (chaîne unique côté brand). */
  faireSku: string;
  /** Nom de la variante côté Faire (souvent libellé couleur). */
  faireVariantName: string;
  /** Libellé couleur extrait des `options[]` Faire (name="Color"). */
  colorLabel: string | null;
  /** Quantité disponible côté Faire. */
  availableQuantity: number;
  /** Prix wholesale en centimes (devise brand). */
  wholesalePriceCents: number | null;
  /** Prix retail en centimes. */
  retailPriceCents: number | null;
  /** Poids Faire en grammes (0 si non renseigné). */
  weightGrams: number;
  /** lifecycle_state de la variante (PUBLISHED / DRAFT / UNPUBLISHED / DELETED). */
  lifecycleState: string | null;
  /** Première image de la variante (URL Faire CDN). */
  imageUrl: string | null;
  /** ProductColor.id BJ pré-suggéré par matching nom (peut être null). */
  suggestedLocalColorId: string | null;
}

export interface FaireLinkLocalColor {
  /** ProductColor.id BJ (clé du mapping). */
  productColorId: string;
  /** Color.id BJ. */
  colorId: string;
  /** Libellé couleur. */
  name: string;
  hex: string | null;
  patternImage: string | null;
  saleType: "UNIT" | "PACK";
  /** Aperçu (1ʳᵉ image de la variante BJ, peut être null). */
  productImage: string | null;
  /** Prix unitaire BJ (pour UNIT) ou prix total (pour PACK). */
  unitPrice: number;
  /** Stock BJ pour cette variante. */
  stock: number;
  /** Poids BJ en kg. */
  weightKg: number;
  /** SKU local généré (pour aider l'admin à retrouver la même variante côté Faire). */
  expectedFaireSku: string;
}

export interface FaireLinkPreview {
  productId: string;
  productName: string;
  reference: string;
  /** SKU interrogé (ce que l'utilisatrice a tapé ou le SKU local par défaut). */
  faireSkuInput: string;
  /** ID Faire du produit trouvé (null si rien trouvé). */
  faireProductId: string | null;
  /** Nom du produit côté Faire. */
  faireProductName: string | null;
  /** lifecycle_state du produit (PUBLISHED / DRAFT / UNPUBLISHED / DELETED). */
  faireLifecycleState: string | null;
  /** Aperçu produit Faire (1ʳᵉ image racine). */
  faireProductImage: string | null;
  /** Toutes les ProductColor du produit BJ. */
  localColors: FaireLinkLocalColor[];
  /** Variantes Faire du produit trouvé. */
  candidates: FaireLinkCandidate[];
  /** Liens déjà sauvés en BDD : { ProductColor.id → faireVariantId }. */
  existingLinks: Record<string, string>;
  /** True si Product.faireProductId est déjà renseigné. */
  alreadyLinked: boolean;
  /** Combien d'autres produits Faire matchent ce SKU (informatif — DRAFT/DELETED ignorés). */
  otherMatchesCount: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function normalizeColorName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Même règle que `slugifyPart` dans `lib/faire-sku.ts`. */
function slugifyColor(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Extrait le segment couleur d'un SKU au format `{ref}_{couleur}_{UNIT|PACK}_{suffix}`.
 * Retourne null si le SKU ne suit pas ce format.
 */
function extractColorFromSku(sku: string): string | null {
  const m = sku.match(/^[^_]+_(.+?)_(?:UNIT|PACK)_[^_]+$/i);
  return m ? m[1].toLowerCase() : null;
}

interface FaireApiProduct {
  id: string;
  name?: string;
  lifecycle_state?: string;
  images?: { url?: string; sequence?: number }[];
  variants?: FaireApiVariant[];
}

interface FaireApiVariant {
  id?: string;
  sku?: string;
  name?: string;
  lifecycle_state?: string;
  available_quantity?: number;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  options?: { name?: string; value?: string }[];
  images?: { url?: string; sequence?: number }[];
  /** Poids et dimensions (schéma ExternalMeasurementsV2). weight en grammes. */
  measurements?: {
    weight?: number;
    mass_unit?: "GRAMS" | "KILOGRAMS";
    length?: number;
    width?: number;
    height?: number;
    distance_unit?: "CENTIMETERS" | "INCHES";
  };
  /** Prix moderne par géo-région (remplace wholesale/retail_price_cents dépréciés).
   *  ⚠️ Shape plat côté GET (ExternalProductVariantV2.Price) — chaque entrée est
   *  directement `{ geo_constraint, wholesale_price, retail_price }`. Le shape
   *  imbriqué `prices[].prices[]` n'existe que côté PATCH `product-prices/by-*`. */
  prices?: Array<{
    geo_constraint?: { country_group?: string; country?: string };
    wholesale_price?: { amount_minor?: number; currency?: string };
    retail_price?: { amount_minor?: number; currency?: string };
  }>;
}

/**
 * Transforme une URL `cdn.faire.com/...` en URL locale qui passe par notre
 * proxy serveur — contourne les bloqueurs navigateur qui ciblent ce CDN.
 * Les autres URLs sont renvoyées telles quelles (pas d'altération inutile).
 */
function viaProxyIfFaireCdn(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "cdn.faire.com") {
      return `/api/admin/faire-image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // URL invalide → renvoyer tel quel (le composant <img> avec fallback gère)
  }
  return url;
}

function firstProductImage(p: FaireApiProduct): string | null {
  // Priorité 1 : image racine du produit.
  const imgs = p.images;
  if (imgs && imgs.length > 0) {
    const sorted = [...imgs].sort(
      (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
    );
    const found = sorted.find((i) => typeof i.url === "string" && i.url);
    if (found?.url) return found.url;
  }
  // Priorité 2 : Faire stocke souvent les images uniquement au niveau variante.
  // On prend la 1ʳᵉ image trouvée parmi les variantes (par ordre des variantes,
  // puis par sequence dans la variante).
  for (const v of p.variants ?? []) {
    const url = firstVariantImage(v);
    if (url) return url;
  }
  return null;
}

function firstVariantImage(v: FaireApiVariant): string | null {
  const imgs = v.images;
  if (!imgs || imgs.length === 0) return null;
  const sorted = [...imgs].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  );
  return sorted.find((i) => typeof i.url === "string" && i.url)?.url ?? null;
}

function variantColorLabel(v: FaireApiVariant): string | null {
  if (!v.options) return null;
  const colorOpt = v.options.find(
    (o) => (o.name ?? "").toLowerCase() === "color",
  );
  if (colorOpt?.value) return colorOpt.value;
  // Fallback : si une seule option, prendre sa valeur
  if (v.options.length === 1 && v.options[0].value) return v.options[0].value;
  return v.name ?? null;
}

async function searchFaireBySku(sku: string): Promise<FaireApiProduct[]> {
  const params = new URLSearchParams({
    sku,
    limit: "10",
    page: "1",
  });
  const res = await faireFetch(`/products?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn("[Faire Link] search failed", {
      sku,
      status: res.status,
      body: text.slice(0, 200),
    });
    throw new Error(`Faire a répondu HTTP ${res.status} sur la recherche.`);
  }
  const data = (await res.json()) as { products?: FaireApiProduct[] };
  return data.products ?? [];
}

/**
 * Heuristique : l'input ressemble-t-il à un SKU complet (déjà segmenté
 * `_UNIT_` ou `_PACK_`) ou à une simple référence produit ?
 * - SKU complet → on cherche tel quel (1 seul appel API).
 * - Référence → on génère les SKUs locaux des variantes et on les essaie tous
 *   en parallèle ; premier match gagne.
 */
function looksLikeFullSku(input: string): boolean {
  return /_UNIT_|_PACK_/.test(input);
}

/**
 * Tente une recherche Faire pour chaque SKU candidat en parallèle. Retourne
 * la liste fusionnée (dédupliquée par product id), avec les SKUs essayés et
 * celui qui a matché en premier (pour debug/UI).
 */
async function searchFaireByMultipleSkus(
  candidateSkus: string[],
): Promise<{
  products: FaireApiProduct[];
  triedSkus: string[];
  matchedSku: string | null;
}> {
  if (candidateSkus.length === 0) {
    return { products: [], triedSkus: [], matchedSku: null };
  }

  const results = await Promise.all(
    candidateSkus.map(async (sku) => {
      try {
        const found = await searchFaireBySku(sku);
        return { sku, found };
      } catch (err) {
        logger.warn("[Faire Link] sku search threw", {
          sku,
          error: String(err),
        });
        return { sku, found: [] as FaireApiProduct[] };
      }
    }),
  );

  // Dédup par product id, en gardant l'ordre des SKUs essayés (priorité aux
  // 1ʳᵉ couleurs locales).
  const seen = new Set<string>();
  const merged: FaireApiProduct[] = [];
  let matchedSku: string | null = null;
  for (const r of results) {
    for (const p of r.found) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        merged.push(p);
        if (matchedSku === null) matchedSku = r.sku;
      }
    }
  }
  return {
    products: merged,
    triedSkus: candidateSkus,
    matchedSku,
  };
}

/**
 * Fallback robuste : pagine le catalogue Faire (`GET /products`) et filtre
 * côté serveur les produits dont au moins une variante a un SKU commençant
 * par `{reference}_` (insensible à la casse).
 *
 * Faire n'expose pas de filtre `?sku_prefix=` ; cette stratégie est utilisée
 * uniquement quand la recherche SKU-exact a échoué (cas : la fiche Faire a
 * été publiée avec un suffixe d'ID variante différent de l'ID actuel — fréquent
 * après re-création du produit local).
 *
 * Limite : 10 pages × 250 = 2500 produits max scannés pour éviter de bloquer
 * l'UI sur des catalogues énormes. Faire ne renvoie que les PUBLISHED par
 * défaut, donc on couvre largement le cas "fiche en ligne". La limite était
 * à 4 pages ; passée à 10 le 2026-07-28 (Issyma 746MED : fiche existante non
 * retrouvée parce qu'elle traînait au-delà de la page 4).
 *
 * On matche AUSSI sur le NOM du produit contenant la référence — couvre le
 * cas où l'admin Issyma a créé la fiche à la main avec des SKUs custom qui
 * ne suivent pas notre convention `{ref}_{couleur}_UNIT_{suffix}`, mais dont
 * le nom du produit intègre la référence (« Bague 746MED », « 746MED - Or »…).
 */
const PREFIX_SCAN_MAX_PAGES = 10;
const PREFIX_SCAN_PAGE_SIZE = 250;

async function scanFaireByPrefix(reference: string): Promise<{
  products: FaireApiProduct[];
  pagesScanned: number;
  truncated: boolean;
}> {
  const ref = reference.toLowerCase();
  const needle = `${ref}_`;
  const matches: FaireApiProduct[] = [];
  const seen = new Set<string>();
  let pagesScanned = 0;
  let truncated = false;

  for (let page = 1; page <= PREFIX_SCAN_MAX_PAGES; page++) {
    pagesScanned = page;
    const params = new URLSearchParams({
      limit: String(PREFIX_SCAN_PAGE_SIZE),
      page: String(page),
    });
    const res = await faireFetch(`/products?${params.toString()}`);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn("[Faire Link] prefix scan page failed", {
        page,
        status: res.status,
        body: text.slice(0, 200),
      });
      throw new Error(`Faire a répondu HTTP ${res.status} sur la recherche.`);
    }
    const data = (await res.json()) as { products?: FaireApiProduct[] };
    const products = data.products ?? [];

    for (const p of products) {
      if (seen.has(p.id)) continue;
      const variants = p.variants ?? [];
      const productName = typeof p.name === "string" ? p.name.toLowerCase() : "";
      // Match si au moins une variante :
      //   - a un SKU commençant par « <ref>_ » (format long généré chez nous)
      //   - OU a un SKU strictement égal à la référence (fiche Faire créée à
      //     la main où le SKU = simplement la référence produit, cas vu sur
      //     Issyma 93126 le 2026-07-24).
      // Match aussi si le NOM du produit contient la référence (fiche créée
      // manuellement chez Issyma avec des SKUs custom, cas 746MED 2026-07-28).
      const skuHit = variants.some((v) => {
        const sku = typeof v.sku === "string" ? v.sku.toLowerCase() : "";
        return sku.startsWith(needle) || sku === ref;
      });
      const nameHit = productName.includes(ref);
      if (skuHit || nameHit) {
        matches.push(p);
        seen.add(p.id);
      }
    }

    // Page non pleine → fin du catalogue.
    if (products.length < PREFIX_SCAN_PAGE_SIZE) {
      return { products: matches, pagesScanned, truncated: false };
    }
  }

  // 4 pages pleines → on a peut-être tronqué.
  truncated = true;
  return { products: matches, pagesScanned, truncated };
}

// ────────────────────────────────────────────────────────────────────────────
// previewFaireMatchBySku
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cherche un produit Faire par SKU et construit la preview de mapping.
 * Si `skuInput` est vide, utilise le SKU local généré de la 1ʳᵉ variante BJ.
 */
export async function previewFaireMatchBySku(
  productId: string,
  skuInput?: string,
): Promise<
  | { success: true; data: FaireLinkPreview }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        name: true,
        faireProductId: true,
        colors: {
          select: {
            id: true,
            saleType: true,
            unitPrice: true,
            stock: true,
            weight: true,
            faireVariantId: true,
            color: {
              select: {
                id: true,
                name: true,
                hex: true,
                patternImage: true,
              },
            },
            images: {
              select: { path: true },
              orderBy: { order: "asc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };

    // SKUs locaux générés (qu'on enverrait si on publiait maintenant).
    // Servent à : (a) construire la liste de candidats quand l'admin tape juste
    // la référence (au lieu d'un SKU complet) ; (b) afficher dans la modale le
    // SKU attendu pour chaque couleur (debug).
    const variantsForSku = product.colors
      .filter((c) => c.color)
      .map((c) => ({
        id: c.id,
        saleType: c.saleType,
        color: c.color!,
      }));
    const skuMap = buildFaireVariantSkus(product.reference, variantsForSku);
    const allLocalSkus = Array.from(skuMap.values());

    // Par défaut : la cliente tape juste la référence du produit (« F137 ») et
    // on essaye automatiquement tous les SKUs des variantes. Si elle préfère
    // chercher par SKU précis (cas marginal : fiche Faire créée à la main avec
    // des SKUs custom), elle peut coller un SKU complet.
    const faireSkuInput = (skuInput?.trim() || product.reference).trim();
    if (!faireSkuInput) return { success: false, error: "Référence (SKU) vide." };

    // 1. Recherche côté Faire — stratégie selon l'input
    let products: FaireApiProduct[];
    try {
      if (looksLikeFullSku(faireSkuInput)) {
        // SKU exact saisi par l'admin
        products = await searchFaireBySku(faireSkuInput);
      } else {
        // Référence produit (ex "F137") : 2 étapes.
        //  (a) On essaie tous les SKUs des couleurs locales en parallèle —
        //      rapide, marche quand la fiche Faire a été publiée depuis l'ID
        //      variante actuel.
        //  (b) Si rien trouvé : fallback robuste = pagination du catalogue
        //      Faire avec filtre préfixe SKU. Couvre le cas où la fiche Faire
        //      a un suffixe d'ID variante différent (re-création locale,
        //      publication manuelle, etc.).
        const reference = faireSkuInput.toLowerCase();
        // On essaie en priorité les SKUs longs générés côté BJ, MAIS aussi la
        // référence exacte : certaines fiches Faire (souvent celles créées à
        // la main) portent simplement la référence produit comme SKU sur toutes
        // les variantes (cas Issyma 93126 le 2026-07-24). Sans cet essai,
        // la recherche rapide échoue et on tombe forcément sur le scan lent.
        const matchingLocalSkus = allLocalSkus.filter((s) =>
          s.toLowerCase().startsWith(`${reference}_`),
        );
        const candidateSkus = [faireSkuInput, ...matchingLocalSkus];
        const multi = await searchFaireByMultipleSkus(candidateSkus);
        products = multi.products;
        if (products.length === 0) {
          const scan = await scanFaireByPrefix(reference);
          products = scan.products;
          if (products.length === 0 && scan.truncated) {
            logger.info("[Faire Link] prefix scan truncated", {
              reference,
              pagesScanned: scan.pagesScanned,
            });
          }
        }
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur Faire",
      };
    }

    // Cas : aucun produit trouvé — on renvoie tout de même les localColors
    // pour que la modale montre "aucune fiche trouvée" avec le contexte BJ.
    if (products.length === 0) {
      return buildFaireLinkPreviewFromChosen({
        product,
        chosen: null,
        faireSkuInput,
        otherMatchesCount: 0,
        skuMap,
      });
    }

    // Cas : plusieurs produits matchent. On prend le premier PUBLISHED, sinon
    // le premier tout court — et on remonte le compte des autres pour info.
    const publishedFirst = products.find(
      (p) => p.lifecycle_state === "PUBLISHED",
    );
    const chosen = publishedFirst ?? products[0];
    const otherMatchesCount = products.length - 1;

    return buildFaireLinkPreviewFromChosen({
      product,
      chosen,
      faireSkuInput,
      otherMatchesCount,
      skuMap,
    });
  } catch (err) {
    logger.warn("[Faire Link] previewFaireMatchBySku failed", {
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur",
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// previewFaireByProductId — nouveau flow "picker"
// ────────────────────────────────────────────────────────────────────────────

/**
 * Charge la preview de mapping Faire à partir d'un `faireProductId` que
 * l'admin a explicitement sélectionné dans la liste de candidats (picker).
 *
 * Contrairement à `previewFaireMatchBySku` qui devine le meilleur produit
 * Faire depuis une référence, ici on part d'un ID Faire connu → GET direct.
 * Utilisé quand la référence a des suffixes (676A, 676GD, ED676P…) et que
 * l'admin doit trancher parmi plusieurs candidats.
 */
export async function previewFaireByProductId(
  productId: string,
  faireProductId: string,
): Promise<
  | { success: true; data: FaireLinkPreview }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();

    if (!faireProductId.trim()) {
      return { success: false, error: "ID Faire du produit vide." };
    }

    const product = await loadFaireLinkProduct(productId);
    if (!product) return { success: false, error: "Produit introuvable." };

    const variantsForSku = product.colors
      .filter((c) => c.color)
      .map((c) => ({
        id: c.id,
        saleType: c.saleType,
        color: c.color!,
      }));
    const skuMap = buildFaireVariantSkus(product.reference, variantsForSku);

    let chosen: FaireProduct | null;
    try {
      chosen = await faireGetProduct(faireProductId);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur Faire",
      };
    }
    if (!chosen) {
      return {
        success: false,
        error: `Produit Faire ${faireProductId} introuvable (peut-être supprimé).`,
      };
    }

    return buildFaireLinkPreviewFromChosen({
      product,
      chosen: libFaireProductToApiShape(chosen),
      faireSkuInput: product.reference,
      otherMatchesCount: 0,
      skuMap,
    });
  } catch (err) {
    logger.warn("[Faire Link] previewFaireByProductId failed", {
      productId,
      faireProductId,
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur",
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// searchFaireCandidatesList — nouveau flow "picker"
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vignette d'un candidat Faire pour la modale de liaison (picker).
 * Ligne servie à l'admin quand une référence a des suffixes multiples
 * (676A, 676GD, ED676P…) et que plusieurs fiches matchent.
 */
export interface FaireCandidateProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  sampleSku: string | null;
  variantCount: number;
  lifecycleState: string | null;
}

/**
 * Renvoie la LISTE de tous les produits Faire dont au moins une variante
 * a un SKU contenant la référence, OU dont le nom contient la référence.
 * Triée par pertinence (SKU exact → préfixe → contient → nom contient).
 *
 * Sert au picker de la modale de liaison quand la référence chez Faire a
 * des suffixes (676A, 676GD, ED676P…).
 */
export async function searchFaireCandidatesList(
  query: string,
): Promise<
  | { success: true; data: { candidates: FaireCandidateProduct[]; truncated: boolean } }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();

    const q = query.trim();
    if (!q) return { success: false, error: "Référence vide." };

    let scan: {
      products: FaireApiProduct[];
      pagesScanned: number;
      truncated: boolean;
    };
    try {
      scan = await scanFaireByContains(q);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur Faire",
      };
    }

    const ranked = sortFaireCandidates(scan.products, q);

    const candidates: FaireCandidateProduct[] = ranked.map((p) => {
      const variants = p.variants ?? [];
      const firstSkuVariant = variants.find(
        (v): v is FaireApiVariant & { sku: string } => typeof v.sku === "string",
      );
      return {
        id: p.id,
        name: p.name ?? "(sans nom)",
        imageUrl: viaProxyIfFaireCdn(firstProductImage(p)),
        sampleSku: firstSkuVariant?.sku ?? null,
        variantCount: variants.length,
        lifecycleState: p.lifecycle_state ?? null,
      };
    });

    return {
      success: true,
      data: {
        candidates,
        truncated: scan.truncated,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue.",
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers privés — charge product BJ + build preview from chosen Faire product
// ────────────────────────────────────────────────────────────────────────────

async function loadFaireLinkProduct(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      faireProductId: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          unitPrice: true,
          stock: true,
          weight: true,
          faireVariantId: true,
          color: {
            select: {
              id: true,
              name: true,
              hex: true,
              patternImage: true,
            },
          },
          images: {
            select: { path: true },
            orderBy: { order: "asc" },
            take: 1,
          },
        },
      },
    },
  });
}

type LoadedFaireLinkProduct = NonNullable<
  Awaited<ReturnType<typeof loadFaireLinkProduct>>
>;

/**
 * Construit une FaireLinkPreview à partir d'un produit BJ chargé et d'un
 * FaireApiProduct choisi (celui trouvé par recherche OU sélectionné par
 * l'admin dans le picker). Passer `chosen=null` renvoie une preview vide
 * (cas "aucune fiche Faire trouvée" mais on veut quand même afficher le
 * contexte BJ dans la modale).
 */
async function buildFaireLinkPreviewFromChosen(params: {
  product: LoadedFaireLinkProduct;
  chosen: FaireApiProduct | null;
  faireSkuInput: string;
  otherMatchesCount: number;
  skuMap: Map<string, string>;
}): Promise<{ success: true; data: FaireLinkPreview }> {
  const { product, chosen, faireSkuInput, otherMatchesCount, skuMap } = params;

  // Local colors BJ — Faire ne vend qu'en UNIT (les PACK sont ignorés).
  // Fallback image en 3 niveaux (pc.images → image (productId,colorId) →
  // n'importe quelle image du produit).
  const allProductImages = await prisma.productColorImage.findMany({
    where: { productId: product.id },
    orderBy: { order: "asc" },
    select: { colorId: true, path: true },
  });
  const imageByColorId = new Map<string, string>();
  for (const img of allProductImages) {
    if (!imageByColorId.has(img.colorId)) imageByColorId.set(img.colorId, img.path);
  }
  const anyProductImage = allProductImages[0]?.path ?? null;
  const localColors: FaireLinkLocalColor[] = product.colors
    .filter((pc) => pc.color && pc.saleType === "UNIT")
    .map((pc) => ({
      productColorId: pc.id,
      colorId: pc.color!.id,
      name: pc.color!.name,
      hex: pc.color!.hex,
      patternImage: pc.color!.patternImage,
      saleType: pc.saleType,
      productImage:
        pc.images[0]?.path ??
        imageByColorId.get(pc.color!.id) ??
        anyProductImage,
      unitPrice: Number(pc.unitPrice),
      stock: pc.stock ?? 0,
      weightKg: Number(pc.weight ?? 0),
      expectedFaireSku: skuMap.get(pc.id) ?? product.reference,
    }));

  const existingLinks: Record<string, string> = {};
  for (const pc of product.colors) {
    if (pc.faireVariantId) existingLinks[pc.id] = pc.faireVariantId;
  }

  if (!chosen) {
    return {
      success: true,
      data: {
        productId: product.id,
        productName: product.name,
        reference: product.reference,
        faireSkuInput,
        faireProductId: null,
        faireProductName: null,
        faireLifecycleState: null,
        faireProductImage: null,
        localColors,
        candidates: [],
        existingLinks,
        alreadyLinked: !!product.faireProductId,
        otherMatchesCount: 0,
      },
    };
  }

  const variants: FaireApiVariant[] = chosen.variants ?? [];
  const localBySlug = new Map<string, FaireLinkLocalColor>();
  const localByNormName = new Map<string, FaireLinkLocalColor>();
  for (const lc of localColors) {
    const slug = slugifyColor(lc.name);
    if (slug && !localBySlug.has(slug)) localBySlug.set(slug, lc);
    const norm = normalizeColorName(lc.name);
    if (norm && !localByNormName.has(norm)) localByNormName.set(norm, lc);
  }

  const candidates: FaireLinkCandidate[] = variants
    .filter((v): v is FaireApiVariant & { id: string; sku: string } =>
      Boolean(v.id && v.sku),
    )
    .map((v) => {
      const colorLabel = variantColorLabel(v);
      let suggested: FaireLinkLocalColor | null = null;

      const skuColor = extractColorFromSku(v.sku);
      if (skuColor) {
        suggested = localBySlug.get(skuColor) ?? null;
        if (!suggested) {
          for (const [slug, lc] of localBySlug.entries()) {
            if (slug.startsWith(skuColor) || skuColor.startsWith(slug)) {
              suggested = lc;
              break;
            }
          }
        }
      }
      if (!suggested && colorLabel) {
        const normLabel = normalizeColorName(colorLabel);
        suggested = localByNormName.get(normLabel) ?? null;
        if (!suggested) {
          for (const [norm, lc] of localByNormName.entries()) {
            if (norm.startsWith(normLabel) || normLabel.startsWith(norm)) {
              suggested = lc;
              break;
            }
          }
        }
      }

      const euPrice =
        (v.prices ?? []).find(
          (p) => p.geo_constraint?.country_group === "EUROPEAN_UNION",
        ) ?? v.prices?.[0];
      const wholesaleFromPrices = euPrice?.wholesale_price?.amount_minor ?? null;
      const retailFromPrices = euPrice?.retail_price?.amount_minor ?? null;
      return {
        faireVariantId: v.id,
        faireSku: v.sku,
        faireVariantName: v.name ?? colorLabel ?? v.sku,
        colorLabel,
        availableQuantity: v.available_quantity ?? 0,
        wholesalePriceCents:
          typeof v.wholesale_price_cents === "number"
            ? v.wholesale_price_cents
            : wholesaleFromPrices,
        retailPriceCents:
          typeof v.retail_price_cents === "number"
            ? v.retail_price_cents
            : retailFromPrices,
        weightGrams: v.measurements?.weight ?? 0,
        lifecycleState: v.lifecycle_state ?? null,
        imageUrl: viaProxyIfFaireCdn(firstVariantImage(v)),
        suggestedLocalColorId: suggested?.productColorId ?? null,
      };
    });

  const candidateIds = new Set(candidates.map((c) => c.faireVariantId));
  const filteredExistingLinks: Record<string, string> = {};
  for (const [pcId, fvid] of Object.entries(existingLinks)) {
    if (candidateIds.has(fvid)) filteredExistingLinks[pcId] = fvid;
  }

  return {
    success: true,
    data: {
      productId: product.id,
      productName: product.name,
      reference: product.reference,
      faireSkuInput,
      faireProductId: chosen.id,
      faireProductName: chosen.name ?? null,
      faireLifecycleState: chosen.lifecycle_state ?? null,
      faireProductImage: viaProxyIfFaireCdn(firstProductImage(chosen)),
      localColors,
      candidates,
      existingLinks: filteredExistingLinks,
      alreadyLinked: !!product.faireProductId,
      otherMatchesCount,
    },
  };
}

/** Adapte le shape `FaireProduct` (lib/faire-api.ts, plus strict) vers le
 *  shape interne `FaireApiProduct` utilisé par buildFaireLinkPreviewFromChosen.
 *  Les deux shapes matchent structurellement, seule la propriété `images`
 *  du produit n'est pas typée côté lib alors qu'elle est bien renvoyée par
 *  l'API — on la remonte via un cast intermédiaire. */
function libFaireProductToApiShape(p: FaireProduct): FaireApiProduct {
  const withImages = p as FaireProduct & {
    images?: { url?: string; sequence?: number }[];
  };
  return {
    id: p.id,
    name: p.name,
    lifecycle_state: p.lifecycle_state,
    images: withImages.images,
    variants: p.variants?.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      lifecycle_state: v.lifecycle_state,
      available_quantity: v.available_quantity,
      wholesale_price_cents: v.wholesale_price_cents,
      retail_price_cents: v.retail_price_cents,
      options: v.options,
      images: v.images,
      measurements: v.measurements,
      prices: v.prices,
    })),
  };
}

/**
 * Version "contient" du scan Faire, dédiée au picker de la modale.
 * Un produit matche si au moins une variante a un SKU qui CONTIENT la query
 * (case-insensitive) OU si le nom du produit contient la query. Cela couvre
 * les cas où Faire ajoute des suffixes (676A, 676GD, ED676P…).
 *
 * Limite : 10 pages × 250 = 2500 produits (cf. PREFIX_SCAN_MAX_PAGES). Si la
 * cliente a un catalogue plus large, on la préviendra via `truncated: true`
 * pour qu'elle affine sa recherche.
 */
async function fetchFairePage(page: number): Promise<FaireApiProduct[]> {
  const params = new URLSearchParams({
    limit: String(PREFIX_SCAN_PAGE_SIZE),
    page: String(page),
  });
  const res = await faireFetch(`/products?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn("[Faire Link] contains scan page failed", {
      page,
      status: res.status,
      body: text.slice(0, 200),
    });
    throw new Error(`Faire a répondu HTTP ${res.status} sur la recherche.`);
  }
  const data = (await res.json()) as { products?: FaireApiProduct[] };
  return data.products ?? [];
}

async function scanFaireByContains(query: string): Promise<{
  products: FaireApiProduct[];
  pagesScanned: number;
  truncated: boolean;
}> {
  const needle = query.toLowerCase();

  // Optimisation : on charge la 1ʳᵉ page d'abord, seule. Si elle n'est pas
  // pleine, le catalogue Faire fait ≤ 250 produits → pas besoin d'aller plus
  // loin (cas fréquent pour les brands avec peu de produits — évite 9 requêtes
  // inutiles qui font paraître le picker "bloqué à l'infini").
  const page1Products = await fetchFairePage(1);
  if (page1Products.length < PREFIX_SCAN_PAGE_SIZE) {
    const matches = filterFaireProductsByNeedle(page1Products, needle);
    return { products: matches, pagesScanned: 1, truncated: false };
  }

  // Catalogue > 250 : on parallélise les pages 2 à 10 en un seul Promise.all.
  // Faire n'a pas de rate-limit documenté strict ; les 9 requêtes en parallèle
  // finissent en ~1-3 s au lieu de 15-30 s en séquentiel (mesuré sur catalogue
  // Issyma le 2026-08-02). En cas de 429, le retry backoff de `faireFetch`
  // absorbe.
  const pageIndexes = Array.from({ length: PREFIX_SCAN_MAX_PAGES - 1 }, (_, i) => i + 2);
  const otherPages = await Promise.all(pageIndexes.map((p) => fetchFairePage(p)));

  const seen = new Set<string>();
  const matches: FaireApiProduct[] = [];
  for (const page of [page1Products, ...otherPages]) {
    for (const p of filterFaireProductsByNeedle(page, needle)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      matches.push(p);
    }
  }

  // Truncated = true si la DERNIÈRE page est pleine (catalogue > 2500 produits).
  const lastPage = otherPages[otherPages.length - 1] ?? page1Products;
  const truncated = lastPage.length >= PREFIX_SCAN_PAGE_SIZE;

  return { products: matches, pagesScanned: PREFIX_SCAN_MAX_PAGES, truncated };
}

function filterFaireProductsByNeedle(
  products: FaireApiProduct[],
  needle: string,
): FaireApiProduct[] {
  return products.filter((p) => {
    const variants = p.variants ?? [];
    const productName = typeof p.name === "string" ? p.name.toLowerCase() : "";
    // `skuMatchesQuery` gère les 2 sens + la tokenisation des SKU multi-segment
    // (`A2630_argent_UNIT_xxxx` → tokens `["a2630","argent","unit","xxxx"]`).
    // Sinon un SKU long ne matcherait ni la query courte (car underscore) ni
    // la query longue (SKU trop long pour être contenu).
    const skuHit = variants.some((v) =>
      typeof v.sku === "string" ? skuMatchesQuery(v.sku, needle) : false,
    );
    return skuHit || productName.includes(needle);
  });
}


// ────────────────────────────────────────────────────────────────────────────
// linkFaireProductManually
// ────────────────────────────────────────────────────────────────────────────

/**
 * Écrit les correspondances en BDD : Product.faireProductId + chaque
 * ProductColor.faireVariantId. Reset du snapshot pour forcer un full resync au
 * prochain push. Lance ensuite une sync best-effort pour aligner stock/prix.
 */
export async function linkFaireProductManually(
  productId: string,
  faireProductId: string,
  links: Array<{ productColorId: string; faireVariantId: string }>,
  intents?: {
    /** productColorId des couleurs BJ à créer côté Faire (informatif — la sync post-liaison les crée). */
    colorsToCreate: string[];
    /** faireVariantId des variantes orphelines à supprimer. */
    orphansToDelete: string[];
    /** faireVariantId des variantes orphelines à importer en tant que ProductColor BJ + lier. */
    orphansToImport: string[];
  },
): Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  /** Nombre de couleurs BJ orphelines créées côté Faire par la sync post-liaison. */
  autoCreatedOnMarketplace?: number;
  /** Variantes Faire orphelines supprimées avant la sync. */
  deletedOnMarketplace?: number;
  /** Variantes Faire orphelines importées en tant que ProductColor BJ liée. */
  importedFromMarketplace?: number;
  /** Warning non bloquant : la liaison est posée mais la sync post-liaison a
   *  échoué. L'admin peut relancer « Resync » depuis la fiche. */
  syncWarning?: string;
}> {
  try {
    await requireAdmin();

    if (!faireProductId.trim()) {
      return { success: false, error: "ID Faire du produit vide." };
    }
    if (links.length === 0 && (!intents || intents.colorsToCreate.length === 0)) {
      return { success: false, error: "Aucune couleur sélectionnée." };
    }

    // Validation : pas de doublon de faireVariantId
    const seenFv = new Set<string>();
    for (const l of links) {
      if (seenFv.has(l.faireVariantId)) {
        return {
          success: false,
          error: `La variante Faire ${l.faireVariantId} apparaît plusieurs fois dans le mapping.`,
        };
      }
      seenFv.add(l.faireVariantId);
    }
    // Validation : 1 ProductColor BJ = 1 variante Faire max
    const seenLocal = new Set<string>();
    for (const l of links) {
      if (seenLocal.has(l.productColorId)) {
        return {
          success: false,
          error: "Une variante locale est liée à plusieurs variantes Faire.",
        };
      }
      seenLocal.add(l.productColorId);
    }

    // Vérifie que les ProductColor appartiennent bien à ce produit
    const productColors = await prisma.productColor.findMany({
      where: { productId, id: { in: links.map((l) => l.productColorId) } },
      select: { id: true },
    });
    if (productColors.length !== links.length) {
      return {
        success: false,
        error: "Certaines variantes sélectionnées n'appartiennent pas à ce produit.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          faireProductId: faireProductId.trim(),
          faireLastSyncSnapshot: Prisma.DbNull,
          faireSyncRequired: false,
        },
      });

      // Reset propre : on efface d'abord tous les faireVariantId de ce produit
      await tx.productColor.updateMany({
        where: { productId },
        data: { faireVariantId: null },
      });

      for (const l of links) {
        await tx.productColor.update({
          where: { id: l.productColorId },
          data: { faireVariantId: l.faireVariantId.trim() },
        });
      }
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[Faire Link] Manual link saved", {
      productId,
      faireProductId,
      linkedColors: links.length,
    });

    // Suppression des variantes Faire orphelines marquées par l'admin.
    // Fait avant la sync pour éviter que faireUpdateProduct ne les considère
    // comme variants modifiés à repousser.
    let deletedOnMarketplace = 0;
    if (intents && intents.orphansToDelete.length > 0) {
      const { faireFetch } = await import("@/lib/faire-api");
      for (const faireVariantId of intents.orphansToDelete) {
        try {
          const res = await faireFetch(
            `/products/${encodeURIComponent(faireProductId.trim())}/variants/${encodeURIComponent(faireVariantId)}`,
            { method: "DELETE" },
          );
          if (res.ok || res.status === 404) {
            deletedOnMarketplace += 1;
          } else {
            logger.warn("[Faire Link] Suppression orpheline refusée", {
              faireVariantId,
              status: res.status,
            });
          }
        } catch (err) {
          logger.warn("[Faire Link] Suppression orpheline en erreur", {
            faireVariantId,
            error: String(err),
          });
        }
      }
    }

    // Import des orphelines Faire marquées « Créer chez nous ». Fait APRÈS le
    // link (qui a posé faireProductId) et AVANT la sync post-liaison.
    let importedFromMarketplace = 0;
    if (intents && intents.orphansToImport.length > 0) {
      for (const faireVariantId of intents.orphansToImport) {
        try {
          const imp = await createLocalVariantFromFaireVariant(productId, faireVariantId);
          if (imp.success) {
            importedFromMarketplace += 1;
          } else {
            logger.warn("[Faire Link] Import orpheline échoué", {
              faireVariantId,
              error: imp.error,
            });
          }
        } catch (err) {
          logger.warn("[Faire Link] Import orpheline en erreur", {
            faireVariantId,
            error: String(err),
          });
        }
      }
    }

    // Renommage SKU côté Faire pour chaque variante liée à la main.
    // Faire garde le SKU d'origine des variantes (souvent hérité de la brand
    // via le portail Faire ou d'un ancien format). BJ génère ses propres SKU
    // (`buildFaireVariantSkus`) qui sont ensuite utilisés par les endpoints
    // batch `/product-inventory/by-skus` et `/product-prices/by-skus` — ces
    // endpoints matchent par SKU (pas par ID de variante), donc sans rename
    // toute maj prix/stock échoue avec HTTP 404. Incident déclencheur :
    // issyma / produit 1880 (2026-08-04) — 8 couleurs liées le 2 août, tous
    // les pushs prix ultérieurs cassaient 13/13. Best-effort : un rename qui
    // échoue n'annule pas la liaison, le filet `unknownSku` dans faire-update
    // remonte un message clair si le problème persiste.
    if (links.length > 0) {
      const { buildSingleFaireSku } = await import("@/lib/faire-sku");
      const { faireRenameVariantSku } = await import("@/lib/faire-rename-sku");
      const linkedProductColors = await prisma.productColor.findMany({
        where: { id: { in: links.map((l) => l.productColorId) } },
        select: {
          id: true,
          saleType: true,
          color: { select: { id: true, name: true } },
        },
      });
      const productMeta = await prisma.product.findUnique({
        where: { id: productId },
        select: { reference: true },
      });
      if (productMeta) {
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const pc = linkedProductColors.find((c) => c.id === l.productColorId);
          if (!pc) continue;
          // Link manuel = 1 ProductColor ↔ 1 variante Faire, donc mono-taille
          // supposée (sizeName = null). Si le produit BJ passe plus tard en
          // multi-taille, la sync forcée régénérera les SKU côté Faire via
          // le PATCH consolidé.
          const sku = buildSingleFaireSku(
            productMeta.reference,
            {
              id: pc.id,
              saleType: pc.saleType,
              color: pc.color,
              sizeName: null,
            },
            i,
          );
          await faireRenameVariantSku(
            faireProductId.trim(),
            l.faireVariantId.trim(),
            sku,
          );
        }
      }
    }

    // Sync best-effort post-liaison : on pousse stock/prix/visibilité pour
    // aligner les 2 côtés sans étape manuelle. Si la sync échoue, on garde la
    // liaison et on remonte un warning. La sync s'occupe aussi de créer côté
    // Faire les couleurs BJ non-mappées (variantsAdded dans le diff).
    let syncWarning: string | undefined;
    let autoCreatedOnMarketplace = 0;
    try {
      const { faireUpdateProduct } = await import("@/lib/faire-update");
      // forceFullSync obligatoire : le lien vient de reset `faireLastSyncSnapshot`
      // à null, or le chemin nominal de faireUpdateProduct saute l'envoi des
      // prix (batch /product-prices/by-skus) tant qu'il n'a pas un prev snapshot
      // pour calculer un delta. Sans ce flag, les prix restent ceux configurés
      // côté portail Faire. Aligné sur PFS/Ankorstore/eFashion qui font pareil.
      const res = await faireUpdateProduct(productId, { forceFullSync: true });
      if (!res.success) syncWarning = res.error;
      autoCreatedOnMarketplace = intents?.colorsToCreate.length ?? 0;
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : String(err);
      logger.warn("[Faire Link] Post-link sync failed", {
        productId,
        error: err,
      });
    }

    return {
      success: true,
      linked: links.length,
      autoCreatedOnMarketplace,
      deletedOnMarketplace,
      importedFromMarketplace,
      syncWarning,
    };
  } catch (err) {
    logger.warn("[Faire Link] linkFaireProductManually failed", {
      error: String(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur",
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// removeFaireMatch
// ────────────────────────────────────────────────────────────────────────────

/**
 * Efface le lien Faire d'un produit (sans rien toucher chez Faire).
 * Pattern miroir de `removePfsMatch` / `removeAnkorstoreMatch`.
 */
export async function removeFaireMatch(
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: {
          faireProductId: null,
          faireLastSyncSnapshot: Prisma.DbNull,
          faireSyncRequired: false,
        },
      });
      await tx.productColor.updateMany({
        where: { productId },
        data: { faireVariantId: null },
      });
    });

    revalidatePath("/admin/produits");
    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidateTag("products", "default");

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Faire] removeFaireMatch failed", { productId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Crée une ProductColor UNIT locale à partir d'une variante Faire existante,
 * et la lie automatiquement (faireVariantId déjà posé). Utilisé depuis la
 * modale de liaison quand Faire a une variante en plus : « Créer chez nous ».
 * Prérequis : `product.faireProductId` posé.
 */
export async function createLocalVariantFromFaireVariant(
  productId: string,
  faireVariantId: string,
): Promise<{
  success: boolean;
  error?: string;
  productColorId?: string;
  createdColor?: boolean;
}> {
  try {
    await requireAdmin();

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        reference: true,
        faireProductId: true,
        colors: {
          where: { saleType: "UNIT" },
          select: { weight: true },
        },
      },
    });
    if (!product) return { success: false, error: "Produit introuvable." };
    if (!product.faireProductId) {
      return {
        success: false,
        error: "Produit non lié à Faire — finissez d'abord la liaison de base.",
      };
    }

    const { faireGetProduct } = await import("@/lib/faire-api");
    const { generateSku } = await import("@/lib/sku");
    const faireProduct = await faireGetProduct(product.faireProductId);
    if (!faireProduct) {
      return { success: false, error: "Produit Faire introuvable." };
    }
    const variant = (faireProduct.variants ?? []).find((v) => v.id === faireVariantId);
    if (!variant) {
      return { success: false, error: `Variante Faire ${faireVariantId} introuvable.` };
    }

    // Extrait le nom de couleur depuis les options Faire (option `color` ou 1ʳᵉ trouvée).
    const colorOpt =
      variant.options?.find((o) => o.name.toLowerCase() === "color") ??
      variant.options?.[0];
    const colorName = colorOpt?.value?.trim() || variant.name?.trim() || variant.sku.trim() || "Couleur";

    let bjColor = await (async () => {
      const normalized = colorName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const all = await prisma.color.findMany({ select: { id: true, name: true } });
      return all.find(
        (c) =>
          c.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim() === normalized,
      ) ?? null;
    })();
    let createdColor = false;
    if (!bjColor) {
      const created = await prisma.color.create({
        data: { name: colorName, hex: "#CCCCCC" },
        select: { id: true, name: true },
      });
      bjColor = created;
      createdColor = true;
      logger.info("[Faire Link] Color BJ créée à la volée depuis variante Faire", {
        colorId: bjColor.id,
        name: bjColor.name,
      });
    }

    let size = await prisma.size.findFirst({
      where: { name: { in: ["TU", "Taille unique"] } },
      select: { id: true },
    });
    if (!size) {
      size = await prisma.size.findFirst({
        orderBy: { position: "asc" },
        select: { id: true },
      });
    }
    if (!size) {
      return {
        success: false,
        error: "Aucune taille définie dans la bibliothèque BJ — crée d'abord une taille.",
      };
    }

    // Anti-doublon : si le produit a déjà une ProductColor UNIT sur cette Color,
    // on RELIE l'existante au lieu d'en créer une nouvelle. Erreur si l'existante
    // est déjà liée à une AUTRE variante Faire.
    const existingPc = await prisma.productColor.findFirst({
      where: { productId, colorId: bjColor.id, saleType: "UNIT" },
      select: { id: true, faireVariantId: true },
    });
    if (existingPc) {
      if (existingPc.faireVariantId && existingPc.faireVariantId !== faireVariantId) {
        return {
          success: false,
          error: `La couleur ${bjColor.name} est déjà liée à une autre variante Faire (${existingPc.faireVariantId}). Délie-la d'abord si tu veux la relier à ${faireVariantId}.`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await tx.productColor.update({
          where: { id: existingPc.id },
          data: { faireVariantId },
        });
        await tx.product.update({
          where: { id: productId },
          data: { faireLastSyncSnapshot: Prisma.DbNull },
        });
      });
      revalidatePath(`/admin/produits/${productId}/modifier`);
      revalidatePath(`/admin/produits`);
      revalidateTag("products", "default");
      logger.info("[Faire Link] ProductColor existante reliée à la variante Faire", {
        productId,
        productColorId: existingPc.id,
        faireVariantId,
      });
      return { success: true, productColorId: existingPc.id, createdColor: false };
    }

    // Prix en centimes → euros. Priorité wholesale sur retail.
    const priceCents =
      variant.wholesale_price_cents ?? variant.retail_price_cents ?? 0;
    const unitPrice = priceCents / 100;

    // Poids : bloc measurements (grammes ou kg) ou moyenne existants ou 0.01
    let weight: number | null = null;
    const m = variant.measurements;
    if (m?.weight && m.weight > 0) {
      weight = m.mass_unit === "GRAMS" ? m.weight / 1000 : m.weight;
    }
    if (!weight) {
      weight =
        product.colors.length > 0
          ? product.colors.reduce((sum, c) => sum + (c.weight || 0), 0) / product.colors.length
          : 0.01;
    }

    const totalVariants = await prisma.productColor.count({ where: { productId } });
    const sku = generateSku(product.reference, [bjColor.name], "UNIT", totalVariants + 1);

    const newPc = await prisma.$transaction(async (tx) => {
      const pc = await tx.productColor.create({
        data: {
          productId,
          colorId: bjColor!.id,
          saleType: "UNIT",
          unitPrice,
          stock: 0,
          weight: Number.isFinite(weight) && weight! > 0 ? weight! : 0.01,
          isPrimary: false,
          disabled: false,
          sku,
          faireVariantId,
          variantSizes: {
            create: [{ sizeId: size!.id, quantity: 1 }],
          },
        },
        select: { id: true },
      });
      await tx.product.update({
        where: { id: productId },
        data: { faireLastSyncSnapshot: Prisma.DbNull },
      });
      return pc;
    });

    revalidatePath(`/admin/produits/${productId}/modifier`);
    revalidatePath(`/admin/produits`);
    revalidateTag("products", "default");

    logger.info("[Faire Link] ProductColor créée depuis variante Faire", {
      productId,
      productColorId: newPc.id,
      faireVariantId,
      createdColor,
    });

    return { success: true, productColorId: newPc.id, createdColor };
  } catch (err) {
    logger.warn("[Faire Link] createLocalVariantFromFaireVariant failed", {
      error: String(err),
    });
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}
