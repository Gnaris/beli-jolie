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
import { faireFetch } from "@/lib/faire-api";
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
 * Limite : 4 pages × 250 = 1000 produits max scannés pour éviter de bloquer
 * l'UI sur des catalogues énormes. Faire ne renvoie que les PUBLISHED par
 * défaut, donc on couvre largement le cas "fiche en ligne".
 */
const PREFIX_SCAN_MAX_PAGES = 4;
const PREFIX_SCAN_PAGE_SIZE = 250;

async function scanFaireByPrefix(reference: string): Promise<{
  products: FaireApiProduct[];
  pagesScanned: number;
  truncated: boolean;
}> {
  const ref = reference.toLowerCase();
  const needle = `${ref}_`;
  const matches: FaireApiProduct[] = [];
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
      const variants = p.variants ?? [];
      // Match si au moins une variante :
      //   - a un SKU commençant par « <ref>_ » (format long généré chez nous)
      //   - OU a un SKU strictement égal à la référence (fiche Faire créée à
      //     la main où le SKU = simplement la référence produit, cas vu sur
      //     Issyma 93126 le 2026-07-24).
      if (
        variants.some((v) => {
          const sku = typeof v.sku === "string" ? v.sku.toLowerCase() : "";
          return sku.startsWith(needle) || sku === ref;
        })
      ) {
        matches.push(p);
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

    // 2. Local colors BJ
    const localColors: FaireLinkLocalColor[] = product.colors
      .filter((pc) => pc.color)
      .map((pc) => ({
        productColorId: pc.id,
        colorId: pc.color!.id,
        name: pc.color!.name,
        hex: pc.color!.hex,
        patternImage: pc.color!.patternImage,
        saleType: pc.saleType,
        productImage: pc.images[0]?.path ?? null,
        unitPrice: Number(pc.unitPrice),
        stock: pc.stock ?? 0,
        expectedFaireSku: skuMap.get(pc.id) ?? product.reference,
      }));

    // 3. Existing links pour pré-remplir la modale à la réouverture.
    const existingLinks: Record<string, string> = {};
    for (const pc of product.colors) {
      if (pc.faireVariantId) existingLinks[pc.id] = pc.faireVariantId;
    }

    // Cas : aucun produit trouvé
    if (products.length === 0) {
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

    // Cas : plusieurs produits matchent. On prend le premier PUBLISHED, sinon
    // le premier tout court — et on remonte le compte des autres pour info.
    const publishedFirst = products.find(
      (p) => p.lifecycle_state === "PUBLISHED",
    );
    const chosen = publishedFirst ?? products[0];
    const otherMatchesCount = products.length - 1;

    // 4. Candidates Faire (variantes du produit choisi)
    const variants: FaireApiVariant[] = chosen.variants ?? [];
    // Pour le matching auto : on précalcule pour chaque couleur BJ son slug
    // (même règle que le générateur de SKU côté `lib/faire-sku.ts`) et son nom
    // normalisé sans accent.
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
        // Suggestion auto en 3 étapes :
        //  (a) SKU = source de vérité. On extrait le segment couleur du SKU
        //      Faire (ex `f137_argent_UNIT_btjq32q5` → `argent`) et on cherche
        //      une couleur BJ dont le slug commence par ce segment (couvre les
        //      cas accent : "Argenté" slug "argent" ⇔ "Argent" slug "argent",
        //      ou troncature côté Faire si SKU long).
        //  (b) Fallback exact sur le nom de l'option couleur (`options[].value`).
        //  (c) Fallback préfixe sur le nom (l'un inclus dans l'autre).
        let suggested: FaireLinkLocalColor | null = null;

        const skuColor = extractColorFromSku(v.sku);
        if (skuColor) {
          // Match exact
          suggested = localBySlug.get(skuColor) ?? null;
          // Match préfixe (BJ slug commence par SKU couleur, ou inverse)
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

        return {
          faireVariantId: v.id,
          faireSku: v.sku,
          faireVariantName: v.name ?? colorLabel ?? v.sku,
          colorLabel,
          availableQuantity: v.available_quantity ?? 0,
          wholesalePriceCents:
            typeof v.wholesale_price_cents === "number"
              ? v.wholesale_price_cents
              : null,
          retailPriceCents:
            typeof v.retail_price_cents === "number"
              ? v.retail_price_cents
              : null,
          lifecycleState: v.lifecycle_state ?? null,
          imageUrl: viaProxyIfFaireCdn(firstVariantImage(v)),
          suggestedLocalColorId: suggested?.productColorId ?? null,
        };
      });

    // Filtre les anciens liens qui pointent vers une variante Faire qui n'existe
    // plus dans la nouvelle fiche trouvée. Cas typique : l'admin avait lié à
    // une fiche Faire ensuite supprimée/republiée → ses faireVariantId stockés
    // pointent vers du néant. Sans ce filtre, l'UI affiche "Pas encore liée"
    // partout et n'applique pas les suggestions auto.
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
): Promise<{
  success: boolean;
  error?: string;
  linked?: number;
  /** Warning non bloquant : la liaison est posée mais la sync post-liaison a
   *  échoué. L'admin peut relancer « Resync » depuis la fiche. */
  syncWarning?: string;
}> {
  try {
    await requireAdmin();

    if (!faireProductId.trim()) {
      return { success: false, error: "ID Faire du produit vide." };
    }
    if (links.length === 0) {
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

    // Sync best-effort post-liaison : on pousse stock/prix/visibilité pour
    // aligner les 2 côtés sans étape manuelle. Si la sync échoue, on garde la
    // liaison et on remonte un warning.
    let syncWarning: string | undefined;
    try {
      const { faireUpdateProduct } = await import("@/lib/faire-update");
      const res = await faireUpdateProduct(productId);
      if (!res.success) syncWarning = res.error;
    } catch (err) {
      syncWarning = err instanceof Error ? err.message : String(err);
      logger.warn("[Faire Link] Post-link sync failed", {
        productId,
        error: err,
      });
    }

    return { success: true, linked: links.length, syncWarning };
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
