/**
 * PFS Verify Apply — applique les décisions de la cliente sur les écarts détectés.
 *
 * Pour chaque écart listé par `verifyPfsProduct`, la cliente choisit dans le
 * tooltip du badge une direction :
 *   - "push" (défaut) → notre valeur locale est envoyée sur PFS.
 *   - "pull"          → la valeur PFS remplace la valeur locale, et on
 *                       marque les autres marketplaces (Ankor/eFashion/Faire)
 *                       comme "Synchro nécessaire" via `*SyncRequired`.
 *
 * Périmètre **Lot B** — champs simples uniquement :
 *   Produit : name, description, dimensions, isBestSeller, productStatus
 *   Variante : price, stock, weight
 *
 * Les champs délicats (composition/pays/saison/catégorie/famille/genre) et
 * les changements structurels (extraVariant/missingVariant/saleType/isActive)
 * sont refusés au niveau serveur avec un message clair — la cliente pourra
 * les corriger manuellement (ou attendre le Lot C).
 */

import { prisma } from "@/lib/prisma";
import { pfsCheckReference, pfsGetVariants, type PfsVariantDetail } from "@/lib/pfs-api";
import {
  pfsUpdateProduct,
  pfsPatchVariants,
  pfsSetVariantsAvailability,
  pfsUpdateStatus,
  type PfsStatus,
} from "@/lib/pfs-api-write";
import { mapLocalToPfsStatus } from "@/lib/pfs-status";
import {
  applyMarketplaceMarkup,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import { logger } from "@/lib/logger";
import {
  issueKey as issueKeyShared,
  isFieldSupportedLotB as isFieldSupportedLotBShared,
  isPushSupportedLotB as isPushSupportedLotBShared,
  isPullSupportedLotB as isPullSupportedLotBShared,
} from "@/lib/pfs-verify-apply-shared";
import {
  pushAddPfsVariantFromLocal,
  pushRemovePfsVariant,
  pullAddLocalVariantFromPfs,
  pullRemoveLocalVariant,
} from "@/lib/pfs-verify-variant-ops";
import { Prisma } from "@prisma/client";
import { pfsAdminFetchMaterialComposition } from "@/lib/pfs-admin-api";
import { clampStock } from "@/lib/product-variant-validation";

// ─── Types publics ─────────────────────────────────────────────────────────

export type ApplyDirection = "push" | "pull";

export interface PfsVerifyActionInput {
  /** Clé stable de l'écart — cf. `issueKey(issue)`. */
  key: string;
  direction: ApplyDirection;
}

export interface PfsVerifyApplyReport {
  /** Actions appliquées avec succès. */
  applied: { key: string; direction: ApplyDirection }[];
  /** Actions refusées (champ non pris en charge, écart déjà résolu, etc.). */
  skipped: { key: string; reason: string }[];
  /** Erreurs techniques d'application. */
  errors: {
    key: string;
    error: string;
    /** Si présent : compositions PFS sans mapping local — la cliente peut
     *  cliquer sur « Créer automatiquement » côté UI pour les créer d'un
     *  coup avec le nom FR + Uid + Code PFS pré-remplis. */
    missingCompositions?: PfsMissingCompositionInfo[];
  }[];
}

/** Métadonnées d'une matière PFS absente de la bibliothèque locale.
 *  Assez pour proposer une création automatique côté UI avec mapping
 *  complet vers PFS pré-rempli. */
export interface PfsMissingCompositionInfo {
  /** Salesforce Uid PFS (identifiant stable, clé de matching prioritaire). */
  pfsUid: string;
  /** Code canonique PFS (ex: "ELASTHANNE"). Fallback = valeur brute. */
  pfsRef: string;
  /** Nom local suggéré, best-effort : LabelFR > LabelEN > Code. */
  suggestedName: string;
  /** Labels par locale (fr/en/de/es/it) — utilisés pour traductions. */
  labels: Record<string, string>;
}

/** Erreur dédiée levée par resolvePfsCompositionsToLocal quand ≥ 1 matière
 *  PFS est absente localement. Portée jusqu'au rapport pour permettre à
 *  l'UI d'afficher un bouton « Créer automatiquement ». */
export class PfsCompositionsMissingError extends Error {
  readonly missing: PfsMissingCompositionInfo[];
  constructor(missing: PfsMissingCompositionInfo[], message: string) {
    super(message);
    this.name = "PfsCompositionsMissingError";
    this.missing = missing;
  }
}

// Réexports pour compat : la source de vérité vit dans
// `lib/pfs-verify-apply-shared.ts` (client-safe, sans Prisma).
export const issueKey = issueKeyShared;
export const isFieldSupportedLotB = isFieldSupportedLotBShared;
export const isPushSupportedLotB = isPushSupportedLotBShared;
export const isPullSupportedLotB = isPullSupportedLotBShared;

// ─── Types locaux ──────────────────────────────────────────────────────────

interface ApplyContext {
  productId: string;
  pfsProductId: string;
  local: LocalRow;
  pfsProduct: NonNullable<Awaited<ReturnType<typeof pfsCheckReference>>["product"]>;
  pfsVariants: PfsVariantDetail[];
  markup: MarkupConfig | undefined;
}

// ─── Entrée principale ─────────────────────────────────────────────────────

/**
 * Applique **uniquement** les actions « Prendre PFS » (pull) sur un produit,
 * de façon synchrone. Les actions « Envoyer vers PFS » (push) présentes dans
 * la liste sont ignorées et retournées telles quelles dans
 * `remainingPushActions`, pour que l'appelant puisse les enqueue dans la file
 * marketplace en tâche de fond.
 *
 * Utilisé par le server action `applyPfsVerifyPullsAndCollect` : la modale de
 * push vers Ankor/eFashion/Faire doit s'ouvrir dès que les valeurs locales
 * sont posées ; les push PFS peuvent partir en parallèle sans faire attendre
 * la cliente.
 */
export async function applyPfsVerifyPullsOnly(
  productId: string,
  actions: PfsVerifyActionInput[],
): Promise<{ report: PfsVerifyApplyReport; remainingPushActions: PfsVerifyActionInput[] }> {
  const report: PfsVerifyApplyReport = { applied: [], skipped: [], errors: [] };
  const remainingPushActions: PfsVerifyActionInput[] = [];
  if (actions.length === 0) return { report, remainingPushActions };

  const pullActions = actions.filter((a) => a.direction === "pull");
  for (const a of actions) {
    if (a.direction === "push") remainingPushActions.push(a);
  }
  if (pullActions.length === 0) return { report, remainingPushActions };

  const local = await loadProductWithVariants(productId);
  if (!local) throw new Error("Produit introuvable en base");
  if (!local.pfsProductId) throw new Error("Produit non publié sur PFS");

  const checkRef = await pfsCheckReference(local.reference);
  if (!checkRef?.exists || !checkRef.product) {
    throw new Error(`Référence ${local.reference} introuvable côté PFS`);
  }
  await preferMobileComposition(checkRef.product, local.reference);
  const variantsResp = await pfsGetVariants(checkRef.product.id);

  const markupConfigs = await loadMarketplaceMarkupConfigs();

  const ctx: ApplyContext = {
    productId,
    pfsProductId: local.pfsProductId,
    local,
    pfsProduct: checkRef.product,
    pfsVariants: variantsResp.data ?? [],
    markup: markupConfigs.pfs,
  };

  const productPullActions: ParsedAction[] = [];
  const variantPullActions: ParsedAction[] = [];
  const structuralPullActions: ParsedAction[] = [];
  for (const a of pullActions) {
    const parsed = parseKey(a.key);
    if (!parsed) {
      report.skipped.push({ key: a.key, reason: "Clé d'écart invalide" });
      continue;
    }
    if (!isFieldSupportedLotB(parsed.scope, parsed.field)) {
      report.skipped.push({
        key: a.key,
        reason: `Champ « ${parsed.field} » non pris en charge dans ce lot (à venir)`,
      });
      continue;
    }
    const entry: ParsedAction = { ...parsed, direction: "pull", rawKey: a.key };
    if (isStructuralField(parsed.field)) {
      structuralPullActions.push(entry);
    } else if (parsed.scope === "product") {
      productPullActions.push(entry);
    } else {
      variantPullActions.push(entry);
    }
  }

  // Actions structurelles (missing/extra variant) : appliquées via les
  // opérations atomiques dédiées, en dehors du patch groupé.
  for (const a of structuralPullActions) {
    try {
      await applyStructuralAction(a, ctx);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
    }
  }

  const pullLocalPatch: LocalPatch = { product: {}, variants: new Map() };
  for (const a of productPullActions) {
    try {
      await buildProductPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push(buildErrorEntry(a.rawKey, err));
    }
  }
  for (const a of variantPullActions) {
    try {
      buildVariantPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
    }
  }

  const hadPatch =
    Object.keys(pullLocalPatch.product).length > 0 ||
    pullLocalPatch.variants.size > 0 ||
    pullLocalPatch.compositions !== undefined;
  if (hadPatch) {
    await commitLocalPatch(productId, local, pullLocalPatch);
  }

  return { report, remainingPushActions };
}

export async function applyPfsVerifyActions(
  productId: string,
  actions: PfsVerifyActionInput[],
): Promise<PfsVerifyApplyReport> {
  const report: PfsVerifyApplyReport = { applied: [], skipped: [], errors: [] };
  if (actions.length === 0) return report;

  const local = await loadProductWithVariants(productId);
  if (!local) {
    throw new Error("Produit introuvable en base");
  }
  if (!local.pfsProductId) {
    throw new Error("Produit non publié sur PFS");
  }

  // On charge l'état PFS courant pour valider les actions ET disposer des
  // valeurs à écrire côté local en cas de "pull".
  const checkRef = await pfsCheckReference(local.reference);
  if (!checkRef?.exists || !checkRef.product) {
    throw new Error(`Référence ${local.reference} introuvable côté PFS`);
  }
  await preferMobileComposition(checkRef.product, local.reference);
  const variantsResp = await pfsGetVariants(checkRef.product.id);

  const markupConfigs = await loadMarketplaceMarkupConfigs();

  const ctx: ApplyContext = {
    productId,
    pfsProductId: local.pfsProductId,
    local,
    pfsProduct: checkRef.product,
    pfsVariants: variantsResp.data ?? [],
    markup: markupConfigs.pfs,
  };

  // ── PHASE 1 : Trier + valider ───────────────────────────────────────────
  const productPushActions: ParsedAction[] = [];
  const productPullActions: ParsedAction[] = [];
  const variantPushActions: ParsedAction[] = [];
  const variantPullActions: ParsedAction[] = [];
  // Actions structurelles (ajout/suppression de variante). Traitées à part
  // via `applyStructuralAction` — ni un patch produit, ni un batch variante.
  const structuralActions: ParsedAction[] = [];

  for (const a of actions) {
    const parsed = parseKey(a.key);
    if (!parsed) {
      report.skipped.push({ key: a.key, reason: "Clé d'écart invalide" });
      continue;
    }
    if (!isFieldSupportedLotB(parsed.scope, parsed.field)) {
      report.skipped.push({
        key: a.key,
        reason: `Champ « ${parsed.field} » non pris en charge dans ce lot (à venir)`,
      });
      continue;
    }
    const entry: ParsedAction = { ...parsed, direction: a.direction, rawKey: a.key };
    if (isStructuralField(parsed.field)) {
      structuralActions.push(entry);
      continue;
    }
    if (parsed.scope === "product") {
      (a.direction === "push" ? productPushActions : productPullActions).push(entry);
    } else {
      (a.direction === "push" ? variantPushActions : variantPullActions).push(entry);
    }
  }

  // ── PHASE 1.5 : Actions structurelles (add/remove variante) ─────────────
  // On les applique en premier — elles changent le nombre de variantes en
  // base, ce qui doit précéder tout patch de variantes scalaires. Chaque
  // opération est atomique (create + upload photos, ou delete).
  for (const a of structuralActions) {
    try {
      await applyStructuralAction(a, ctx);
      report.applied.push({ key: a.rawKey, direction: a.direction });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
    }
  }

  // ── PHASE 2 : Appliquer les PULLs (local → BDD) ─────────────────────────
  // On les fait d'abord : plus sûr pour l'utilisatrice si un push échoue.
  const pullLocalPatch: LocalPatch = { product: {}, variants: new Map() };

  for (const a of productPullActions) {
    try {
      await buildProductPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push(buildErrorEntry(a.rawKey, err));
    }
  }
  for (const a of variantPullActions) {
    try {
      buildVariantPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
    }
  }

  const hadScalarPull =
    Object.keys(pullLocalPatch.product).length > 0 ||
    pullLocalPatch.variants.size > 0 ||
    pullLocalPatch.compositions !== undefined;
  if (hadScalarPull) {
    await commitLocalPatch(productId, local, pullLocalPatch);
  }

  // ── PHASE 3 : Appliquer les PUSHs (local → PFS) ─────────────────────────
  // On repart d'un state local frais si la BDD locale a bougé — soit par un
  // pull scalaire (commitLocalPatch), soit par une action structurelle
  // (add/remove variante côté nous). Sans ça, `freshLocal.colors` ne reflète
  // pas l'état réel et un push suivant peut échouer ou ignorer une variante.
  const hadLocalMutation = hadScalarPull || structuralActions.length > 0;
  const freshLocal = hadLocalMutation ? await loadProductWithVariants(productId) : local;
  if (!freshLocal) throw new Error("Produit introuvable après pull");

  // 3a — produit-level push
  if (productPushActions.length > 0) {
    try {
      logger.info("[PFS Verify Apply] Push product-level", {
        productId,
        fields: productPushActions.map((a) => a.field),
      });
      await applyProductPushes(productPushActions, freshLocal, ctx);
      for (const a of productPushActions) {
        report.applied.push({ key: a.rawKey, direction: "push" });
      }
    } catch (err) {
      // Une erreur PFS sur le produit-level tue tout le lot produit
      const msg = humanizeError(err);
      logger.error("[PFS Verify Apply] Product-level push failed", {
        productId,
        fields: productPushActions.map((a) => a.field),
        error: msg,
      });
      for (const a of productPushActions) {
        report.errors.push({ key: a.rawKey, error: msg });
      }
    }
  }

  // 3b — variant-level push (batch pfsPatchVariants)
  if (variantPushActions.length > 0) {
    try {
      logger.info("[PFS Verify Apply] Push variants", {
        productId,
        count: variantPushActions.length,
        fields: variantPushActions.map((a) => `${a.colorRef}/${a.variantType}/${a.field}`),
      });
      await applyVariantPushes(variantPushActions, freshLocal, ctx);
      for (const a of variantPushActions) {
        report.applied.push({ key: a.rawKey, direction: "push" });
      }
    } catch (err) {
      const msg = humanizeError(err);
      logger.error("[PFS Verify Apply] Variant push failed", {
        productId,
        error: msg,
      });
      for (const a of variantPushActions) {
        report.errors.push({ key: a.rawKey, error: msg });
      }
    }
  }

  return report;
}

// ─── Chargement local ──────────────────────────────────────────────────────

async function loadProductWithVariants(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      isBestSeller: true,
      pfsProductId: true,
      pfsLastSyncSnapshot: true,
      tenantId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      countryIsoCode: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      category: {
        select: {
          pfsCategoryId: true,
          pfsFamilyId: true,
          pfsGender: true,
        },
      },
      season: { select: { pfsRef: true, name: true } },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { pfsCompositionRef: true } },
        },
      },
      colors: {
        select: {
          id: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          disabled: true,
          colorId: true,
          color: { select: { pfsColorRef: true, name: true } },
          pfsColorRefOverride: true,
        },
      },
    },
  });
}

type LocalRow = NonNullable<Awaited<ReturnType<typeof loadProductWithVariants>>>;

// ─── Parseur de clé ────────────────────────────────────────────────────────

interface ParsedKey {
  scope: "product" | "color";
  field: string;
  colorRef: string;
  variantType: "UNIT" | "PACK" | "";
}

interface ParsedAction extends ParsedKey {
  direction: ApplyDirection;
  rawKey: string;
}

function parseKey(key: string): ParsedKey | null {
  const parts = key.split(":");
  if (parts.length !== 4) return null;
  const [scope, field, colorRef, variantType] = parts;
  if (scope !== "product" && scope !== "color") return null;
  if (variantType !== "UNIT" && variantType !== "PACK" && variantType !== "") return null;
  return { scope, field, colorRef, variantType };
}

// ─── Résolution variante locale ────────────────────────────────────────────

function findLocalVariant(local: LocalRow, colorRef: string, variantType: string) {
  const norm = normalizeColorRef(colorRef);
  return local.colors.find((v) => {
    if (v.saleType !== variantType) return false;
    const effRef = (v.pfsColorRefOverride || v.color?.pfsColorRef || v.color?.name || "").trim();
    return normalizeColorRef(effRef) === norm;
  });
}

function findPfsVariant(pfsVariants: PfsVariantDetail[], colorRef: string, variantType: string) {
  const norm = normalizeColorRef(colorRef);
  return pfsVariants.find((pv) => {
    if (variantType === "UNIT" && pv.type === "ITEM" && pv.item) {
      return normalizeColorRef(pv.item.color.reference) === norm;
    }
    if (variantType === "PACK" && pv.type === "PACK" && pv.packs?.[0]) {
      return normalizeColorRef(pv.packs[0].color.reference) === norm;
    }
    return false;
  });
}

function normalizeColorRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

// ─── Lecture compo — API admin (mobile) prioritaire ────────────────────────

/**
 * Lit la composition depuis l'API admin PFS (mobile) et la substitue à celle
 * du wholesaler dans `checkRefProduct.material_composition` (mutation en
 * place). Mobile est la source de vérité : la cliente saisit compo via
 * l'appli mobile PFS et le wholesaler renvoie parfois une valeur stale (bug
 * de synchro côté PFS). Le wholesaler ne sert que de fallback si mobile est
 * vide ou HS.
 * Best-effort : silencieux en cas d'échec (compo wholesaler conservée telle
 * quelle).
 */
export async function preferMobileComposition(
  checkRefProduct: NonNullable<Awaited<ReturnType<typeof pfsCheckReference>>["product"]>,
  reference: string,
): Promise<void> {
  if (!checkRefProduct.id) return;
  try {
    const mobileCompo = await pfsAdminFetchMaterialComposition(checkRefProduct.id);
    if (mobileCompo.length > 0) {
      checkRefProduct.material_composition = mobileCompo;
      logger.info("[PFS Verify Apply] Composition lue via API admin (source prioritaire)", {
        pfsProductId: checkRefProduct.id,
        reference,
        count: mobileCompo.length,
      });
    }
  } catch (err) {
    logger.warn("[PFS Verify Apply] Lecture composition (API admin) échouée — fallback wholesaler", {
      pfsProductId: checkRefProduct.id,
      reference,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Construction du patch local (pulls) ───────────────────────────────────

interface LocalPatch {
  product: Partial<{
    name: string;
    description: string;
    isBestSeller: boolean;
    status: "ONLINE" | "OFFLINE" | "ARCHIVED";
    dimensionLength: number | null;
    dimensionWidth: number | null;
    dimensionHeight: number | null;
    dimensionDiameter: number | null;
    dimensionCircumference: number | null;
    categoryId: string;
  }>;
  /**
   * Nouvel état exhaustif des ProductComposition (remplace complètement les
   * lignes existantes en base). `undefined` = pas de pull compo demandé.
   * Array vide = compo à effacer (jamais utilisé aujourd'hui — l'audit ne
   * détecte pas d'écart quand PFS a `[]` et local a `[]`, et un pull ne
   * s'applique que sur écart).
   */
  compositions?: { compositionId: string; percentage: number }[];
  variants: Map<
    string,
    Partial<{ unitPrice: number; stock: number; weight: number; disabled: boolean }>
  >;
}

async function buildProductPullPatch(a: ParsedAction, ctx: ApplyContext, patch: LocalPatch): Promise<void> {
  const pfs = ctx.pfsProduct;
  switch (a.field) {
    case "name":
      patch.product.name = pfs.label?.fr ?? "";
      return;
    case "description": {
      const full = pfs.description?.fr ?? "";
      const idx = full.indexOf("\n\nDimensions :");
      patch.product.description = idx >= 0 ? full.slice(0, idx) : full;
      return;
    }
    case "dimensions": {
      const full = pfs.description?.fr ?? "";
      const dims = extractDimensionsFromPfs(full);
      patch.product.dimensionLength = dims.length;
      patch.product.dimensionWidth = dims.width;
      patch.product.dimensionHeight = dims.height;
      patch.product.dimensionDiameter = dims.diameter;
      patch.product.dimensionCircumference = dims.circumference;
      return;
    }
    case "isBestSeller":
      patch.product.isBestSeller = ctx.pfsVariants.some((v) => v.is_star === true);
      return;
    case "productStatus": {
      const raw = String(pfs.status ?? "").toUpperCase();
      // On mappe le statut PFS vers un statut local pertinent (ONLINE/OFFLINE
      // /ARCHIVED). READY_FOR_SALE → ONLINE, DRAFT → OFFLINE, ARCHIVED /
      // DELETED / NEW → ARCHIVED. On ne remonte jamais en SYNCING (transitoire).
      // NEW = produit PFS créé mais jamais activé (invisible via listProducts,
      // affiché « brouillon » dans l'UI PFS) → sémantiquement équivalent à
      // ARCHIVED chez nous, PAS à ONLINE.
      if (raw === "READY_FOR_SALE") patch.product.status = "ONLINE";
      else if (raw === "DRAFT") patch.product.status = "OFFLINE";
      else if (raw === "ARCHIVED" || raw === "DELETED" || raw === "NEW") patch.product.status = "ARCHIVED";
      else throw new Error(`Statut PFS inconnu : ${raw}`);
      return;
    }
    case "composition": {
      patch.compositions = await resolvePfsCompositionsToLocal(pfs.material_composition ?? []);
      return;
    }
    case "category": {
      // Résolution inverse : trouver la Category BJ locale qui pointe sur la
      // catégorie PFS courante via `Category.pfsCategoryId`. Si aucun mapping
      // trouvé, on lève une erreur claire — l'audit-auto skippe cet écart et
      // continue sur les autres produits (comportement 2026-09-08).
      const pfsCatId = ctx.pfsProduct.category?.id;
      if (!pfsCatId) {
        throw new Error("PFS n'a pas retourné d'identifiant de catégorie.");
      }
      const localCat = await prisma.category.findFirst({
        where: { pfsCategoryId: pfsCatId, tenantId: ctx.local.tenantId },
        select: { id: true, name: true },
      });
      if (!localCat) {
        throw new Error(
          `Catégorie PFS ${pfsCatId} non liée à une catégorie de votre site. Rattachez-la depuis Paramètres → Catégories.`,
        );
      }
      patch.product.categoryId = localCat.id;
      return;
    }
    default:
      throw new Error(`Champ produit non supporté (pull) : ${a.field}`);
  }
}

/**
 * Prend un array de composition PFS (format `checkRef.material_composition`)
 * et le convertit en lignes `ProductComposition` prêtes à écrire en base :
 *   1. Résolution `Composition` locale — priorité `pfsCompositionUid`
 *      (Salesforce Uid, stable et immunisé aux fautes d'orthographe),
 *      fallback `pfsCompositionRef` (Code PFS) pour compat rétro pendant
 *      la migration du backfill.
 *   2. Heal opportuniste : si une compo locale a été trouvée par Ref mais
 *      n'a pas encore de Uid, on lui pose le Uid PFS courant (aligne
 *      progressivement toutes les compos existantes sur la clé Uid).
 *   3. Si aucun match : ON BLOQUE — jette une erreur listant les matières
 *      PFS sans mapping local. La cliente doit créer la Composition
 *      manuellement dans Paramètres avant de relancer l'audit (règle
 *      établie après l'incident du 2026-08-01).
 *   4. Dédoublonnage : si 2 codes PFS distincts mappent sur la même
 *      Composition locale (alias par nom), on additionne les pourcentages.
 */
export async function resolvePfsCompositionsToLocal(
  pfsCompositions: NonNullable<Awaited<ReturnType<typeof pfsCheckReference>>["product"]>["material_composition"],
): Promise<{ compositionId: string; percentage: number }[]> {
  if (pfsCompositions.length === 0) return [];
  const uniqueUids = Array.from(new Set(pfsCompositions.map((m) => m.id).filter(Boolean)));
  const uniqueRefs = Array.from(new Set(pfsCompositions.map((m) => m.reference).filter(Boolean)));
  const existingRows = await prisma.composition.findMany({
    where: {
      OR: [
        ...(uniqueUids.length > 0 ? [{ pfsCompositionUid: { in: uniqueUids } }] : []),
        ...(uniqueRefs.length > 0 ? [{ pfsCompositionRef: { in: uniqueRefs } }] : []),
      ],
    },
    select: { id: true, pfsCompositionRef: true, pfsCompositionUid: true },
  });
  const byUid = new Map(
    existingRows.filter((r) => r.pfsCompositionUid).map((r) => [r.pfsCompositionUid!, r]),
  );
  const byRef = new Map(
    existingRows.filter((r) => r.pfsCompositionRef).map((r) => [r.pfsCompositionRef!, r]),
  );

  const healPromises: Promise<unknown>[] = [];
  const missing: PfsMissingCompositionInfo[] = [];
  const merged = new Map<string, { compositionId: string; percentage: number }>();
  for (const mat of pfsCompositions) {
    let match = mat.id ? byUid.get(mat.id) : undefined;
    if (!match && mat.reference) match = byRef.get(mat.reference);
    if (!match) {
      const suggestedName = mat.labels?.fr ?? mat.labels?.en ?? mat.reference ?? "(sans nom)";
      // Dédoublonne par Uid (ou par ref si pas d'Uid) : PFS renvoie parfois
      // la même matière sur plusieurs slots avec des % différents.
      const dedupKey = mat.id || mat.reference || suggestedName;
      if (!missing.some((m) => (m.pfsUid || m.pfsRef) === dedupKey)) {
        missing.push({
          pfsUid: mat.id || "",
          pfsRef: mat.reference,
          suggestedName,
          labels: mat.labels ?? {},
        });
      }
      continue;
    }
    // Heal opportuniste : matched par Ref mais Uid pas encore rempli localement.
    if (mat.id && !match.pfsCompositionUid) {
      healPromises.push(
        prisma.composition
          .update({ where: { id: match.id }, data: { pfsCompositionUid: mat.id } })
          .catch((err) =>
            logger.warn("[PFS Resolve] Heal Uid skipped (collision ou erreur)", {
              compositionId: match!.id,
              targetUid: mat.id,
              error: err instanceof Error ? err.message : String(err),
            }),
          ),
      );
      match.pfsCompositionUid = mat.id;
      byUid.set(mat.id, match);
    }
    const existing = merged.get(match.id);
    if (existing) {
      existing.percentage += mat.percentage;
    } else {
      merged.set(match.id, { compositionId: match.id, percentage: mat.percentage });
    }
  }
  if (missing.length > 0) {
    const list = missing.map((m) => `« ${m.suggestedName} »`).join(", ");
    const plural = missing.length > 1 ? "s" : "";
    throw new PfsCompositionsMissingError(
      missing,
      `Composition${plural} ${list} absente${plural} de la bibliothèque locale. Créez-la${plural} dans Paramètres → Compositions avant de relancer l'audit.`,
    );
  }
  // On attend les heal mais sans bloquer le retour de la valeur si l'un
  // échoue (allSettled) — les heals sont best-effort.
  if (healPromises.length > 0) await Promise.allSettled(healPromises);
  return Array.from(merged.values());
}

function buildVariantPullPatch(a: ParsedAction, ctx: ApplyContext, patch: LocalPatch): void {
  const local = findLocalVariant(ctx.local, a.colorRef, a.variantType);
  if (!local) throw new Error(`Variante locale ${a.colorRef}/${a.variantType} introuvable`);
  const pv = findPfsVariant(ctx.pfsVariants, a.colorRef, a.variantType);
  if (!pv) throw new Error(`Variante PFS ${a.colorRef}/${a.variantType} introuvable`);

  const existing = patch.variants.get(local.id) ?? {};
  switch (a.field) {
    case "price": {
      // Prix PFS = prix HT unitaire × markup. Pour reconstruire notre prix
      // local, on inverse le markup (approximation, l'arrondi introduit un
      // léger drift accepté par la cliente) et on multiplie par packQuantity
      // pour un PACK (nous stockons le prix TOTAL du pack).
      const pfsUnit = Number(pv.price_sale?.unit?.value ?? 0);
      const base = reverseMarkup(pfsUnit, ctx.markup);
      const qty = local.saleType === "PACK" && local.packQuantity
        ? local.packQuantity
        : 1;
      existing.unitPrice = Math.round(base * qty * 100) / 100;
      break;
    }
    case "stock":
      // Plafond MAX_STOCK : PFS peut renvoyer des valeurs aberrantes (bug côté
      // eux, ex. 29 732 222 222 au lieu de 297). Notre colonne stock est un
      // INT MySQL (max ~2,1 mds) et le métier n'accepte pas plus de 1000.
      existing.stock = clampStock(pv.stock_qty);
      break;
    case "weight":
      existing.weight = Number(pv.weight ?? 0);
      break;
    case "isActive":
      // PFS `is_active=true` → variante visible → `disabled=false` chez nous.
      existing.disabled = pv.is_active === false;
      break;
    default:
      throw new Error(`Champ variante non supporté (pull) : ${a.field}`);
  }
  patch.variants.set(local.id, existing);
}

async function commitLocalPatch(
  productId: string,
  local: LocalRow,
  patch: LocalPatch,
): Promise<void> {
  const otherMarketplaceFlags: Prisma.ProductUpdateInput = {};
  if (local.ankorsProductId) otherMarketplaceFlags.ankorsSyncRequired = true;
  if (local.efashionReferenceBase) otherMarketplaceFlags.efashionSyncRequired = true;
  if (local.faireProductId) otherMarketplaceFlags.faireSyncRequired = true;
  // Reset snapshot PFS : la prochaine sync repartira propre (les valeurs
  // locales et PFS sont maintenant alignées côté écarts appliqués).
  const productData: Prisma.ProductUpdateInput = {
    ...patch.product,
    ...otherMarketplaceFlags,
    pfsSyncRequired: false,
    pfsLastSyncSnapshot: Prisma.DbNull,
  };

  await prisma.$transaction(async (tx) => {
    if (
      Object.keys(patch.product).length > 0 ||
      Object.keys(otherMarketplaceFlags).length > 0 ||
      patch.compositions !== undefined
    ) {
      await tx.product.update({ where: { id: productId }, data: productData });
    }
    if (patch.compositions !== undefined) {
      // Remplacement complet : delete puis recréation. Plus simple et plus
      // robuste qu'un diff (nombre de compos < 5 en pratique).
      await tx.productComposition.deleteMany({ where: { productId } });
      if (patch.compositions.length > 0) {
        await tx.productComposition.createMany({
          data: patch.compositions.map((c) => ({
            productId,
            compositionId: c.compositionId,
            percentage: c.percentage,
            tenantId: local.tenantId,
          })),
        });
      }
    }
    for (const [variantId, data] of patch.variants) {
      const upd: Prisma.ProductColorUpdateInput = {};
      if (data.unitPrice !== undefined) upd.unitPrice = new Prisma.Decimal(data.unitPrice);
      if (data.stock !== undefined) upd.stock = data.stock;
      if (data.weight !== undefined) upd.weight = data.weight;
      if (data.disabled !== undefined) upd.disabled = data.disabled;
      await tx.productColor.update({ where: { id: variantId }, data: upd });
    }
  });
}

// ─── Push produit-level ────────────────────────────────────────────────────

async function applyProductPushes(
  actions: ParsedAction[],
  local: LocalRow,
  ctx: ApplyContext,
): Promise<void> {
  const fields = new Set(actions.map((a) => a.field));

  // Regroupement des champs "descriptifs" en un seul PATCH produit
  const patch: Parameters<typeof pfsUpdateProduct>[1] = {};
  if (fields.has("name")) patch.label = { fr: local.name };
  if (fields.has("description") || fields.has("dimensions")) {
    const desc = local.description + buildDimensionsSuffix(local);
    patch.description = { fr: desc };
  }
  // Catégorie / famille / genre : PFS valide la catégorie CONTRE la famille et
  // le genre — envoyer `category` seul déclenche « Catégorie non valide ».
  // Dès qu'un de ces 3 champs est demandé, on envoie les 3 en bloc pour
  // rester cohérent avec le flux `pfs-update` complet.
  if (fields.has("category") || fields.has("family") || fields.has("gender")) {
    if (!local.category.pfsCategoryId) {
      throw new Error("Envoi impossible : la catégorie locale n'a pas d'identifiant PFS.");
    }
    if (!local.category.pfsFamilyId) {
      throw new Error("Envoi impossible : la catégorie locale n'a pas de famille PFS rattachée.");
    }
    if (!local.category.pfsGender) {
      throw new Error("Envoi impossible : la catégorie locale n'a pas de genre PFS rattaché.");
    }
    patch.category = local.category.pfsCategoryId;
    patch.family = local.category.pfsFamilyId;
    patch.gender_label = local.category.pfsGender;
  }
  if (fields.has("country")) {
    patch.country_of_manufacture = local.countryIsoCode ?? "CN";
  }
  if (fields.has("season")) {
    if (!local.season?.pfsRef) {
      throw new Error("Envoi saison impossible : la saison locale n'a pas de référence PFS rattachée.");
    }
    patch.season_name = local.season.pfsRef;
  }
  if (fields.has("composition")) {
    const compo = local.compositions
      .filter((c) => c.composition.pfsCompositionRef)
      .map((c) => ({
        id: c.composition.pfsCompositionRef as string,
        value: Number(c.percentage),
      }));
    if (compo.length === 0) {
      throw new Error("Envoi composition impossible : aucune composition locale n'a de référence PFS.");
    }
    patch.material_composition = compo;
  }
  if (Object.keys(patch).length > 0) {
    await pfsUpdateProduct(ctx.pfsProductId, patch);
  }

  if (fields.has("isBestSeller")) {
    await pfsUpdateStatus([
      { id: ctx.pfsProductId, status: local.isBestSeller ? "STAR" : "REMOVE_STAR" },
    ]);
  }
  if (fields.has("productStatus")) {
    const target = mapLocalToPfsStatus(local.status);
    await pfsUpdateStatus([{ id: ctx.pfsProductId, status: target as PfsStatus }]);
  }
}

function buildDimensionsSuffix(p: {
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
}): string {
  const parts: string[] = [];
  if (p.dimensionLength != null) parts.push(`Longueur : ${p.dimensionLength}mm`);
  if (p.dimensionWidth != null) parts.push(`Largeur : ${p.dimensionWidth}mm`);
  if (p.dimensionHeight != null) parts.push(`Hauteur : ${p.dimensionHeight}mm`);
  if (p.dimensionDiameter != null) parts.push(`Diamètre : ${p.dimensionDiameter}mm`);
  if (p.dimensionCircumference != null) parts.push(`Circonférence : ${p.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

// ─── Push variant-level ────────────────────────────────────────────────────

async function applyVariantPushes(
  actions: ParsedAction[],
  local: LocalRow,
  ctx: ApplyContext,
): Promise<void> {
  // Grouper les actions par variante locale (une même variante peut avoir
  // plusieurs champs à pousser — prix + stock par exemple).
  const patches = new Map<
    string,
    { variant_id: string; price?: number; stock?: number; weight?: number }
  >();
  // Les changements d'activation passent par un endpoint dédié
  // (`variants/batch/setAvailability`). Le champ `is_active` du PATCH classique
  // est ignoré silencieusement par PFS.
  const availability: { pfsVariantId: string; enable: boolean }[] = [];

  for (const a of actions) {
    const lv = findLocalVariant(local, a.colorRef, a.variantType);
    if (!lv) throw new Error(`Variante locale ${a.colorRef}/${a.variantType} introuvable`);
    if (!lv.pfsVariantId) throw new Error(`Variante ${a.colorRef} sans identifiant PFS`);

    if (a.field === "isActive") {
      // Chez nous `disabled=true` = variante masquée. Côté PFS, on envoie
      // l'opposé — variante visible = `enable=true`.
      availability.push({ pfsVariantId: lv.pfsVariantId, enable: !lv.disabled });
      continue;
    }

    const entry = patches.get(lv.id) ?? { variant_id: lv.pfsVariantId };
    if (a.field === "price") {
      // Reconstitue le prix PFS unitaire depuis le prix local (comme
      // pfs-refresh) : / qty pour un PACK, + markup marketplace.
      const raw = Number(lv.unitPrice);
      const qty = lv.saleType === "PACK" && lv.packQuantity ? lv.packQuantity : 1;
      const unit = Math.round((raw / qty) * 100) / 100;
      const withMarkup = ctx.markup ? applyMarketplaceMarkup(unit, ctx.markup) : unit;
      entry.price = withMarkup;
    }
    if (a.field === "stock") entry.stock = lv.stock ?? 0;
    if (a.field === "weight") entry.weight = lv.weight;
    patches.set(lv.id, entry);
  }

  const payload = Array.from(patches.values()).map((p) => ({
    variant_id: p.variant_id,
    ...(p.price !== undefined ? { price_eur_ex_vat: p.price } : {}),
    ...(p.stock !== undefined ? { stock_qty: p.stock } : {}),
    ...(p.weight !== undefined ? { weight: p.weight } : {}),
  }));

  if (payload.length > 0) {
    logger.info("[PFS Verify Apply] Push variants", { count: payload.length });
    await pfsPatchVariants(payload);
  }
  if (availability.length > 0) {
    logger.info("[PFS Verify Apply] Push variants availability", {
      count: availability.length,
    });
    await pfsSetVariantsAvailability(availability);
  }
}

// ─── Utils ─────────────────────────────────────────────────────────────────

function reverseMarkup(price: number, markup: MarkupConfig | undefined): number {
  if (!markup || markup.value === 0) return price;
  switch (markup.type) {
    case "percent":
      return price / (1 + markup.value / 100);
    case "multiplier":
      return markup.value === 0 ? price : price / markup.value;
    case "fixed":
      return price - markup.value;
    default:
      return price;
  }
}

/** Parse "Longueur : 12mm / Largeur : 5mm" en dimensions structurées. */
export function extractDimensionsFromPfs(pfsDescription: string): {
  length: number | null;
  width: number | null;
  height: number | null;
  diameter: number | null;
  circumference: number | null;
} {
  const out = {
    length: null as number | null,
    width: null as number | null,
    height: null as number | null,
    diameter: null as number | null,
    circumference: null as number | null,
  };
  const idx = pfsDescription.indexOf("Dimensions :");
  if (idx < 0) return out;
  const dimStr = pfsDescription.slice(idx + "Dimensions :".length);
  const pick = (label: string): number | null => {
    // Match "Longueur : 12mm" ou "Longueur:12 mm" tolérant.
    const re = new RegExp(`${label}\\s*:\\s*([0-9]+(?:[.,][0-9]+)?)\\s*mm`, "i");
    const m = dimStr.match(re);
    if (!m) return null;
    return Number(m[1].replace(",", "."));
  };
  out.length = pick("Longueur");
  out.width = pick("Largeur");
  out.height = pick("Hauteur");
  out.diameter = pick("Diam[eè]tre");
  out.circumference = pick("Circonf[eé]rence");
  return out;
}

function humanizeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Construit une entrée `errors[]` : détecte si l'erreur porte des
 *  compositions PFS manquantes (via PfsCompositionsMissingError) et attache
 *  ces méta pour permettre à l'UI de proposer la création en 1 clic. */
function buildErrorEntry(key: string, err: unknown): PfsVerifyApplyReport["errors"][number] {
  const entry: PfsVerifyApplyReport["errors"][number] = { key, error: humanizeError(err) };
  if (err instanceof PfsCompositionsMissingError) {
    entry.missingCompositions = err.missing;
  }
  return entry;
}

// ─── Actions structurelles (ajout / suppression de variante) ───────────────

/**
 * Champs qui ne sont pas des scalaires patchables mais des opérations
 * atomiques sur la structure (une couleur en plus / en moins). Traités
 * séparément par `applyStructuralAction` — jamais dans les patches groupés.
 */
function isStructuralField(field: string): boolean {
  return field === "missingVariant" || field === "extraVariant";
}

/**
 * Route une action `missingVariant` / `extraVariant` vers la bonne opération
 * atomique dans `lib/pfs-verify-variant-ops`. Sémantique :
 *
 *   missingVariant + push → « Ajouter sur PFS » (pushAddPfsVariantFromLocal)
 *   missingVariant + pull → « Retirer chez nous » (pullRemoveLocalVariant)
 *   extraVariant   + push → « Retirer de PFS » (pushRemovePfsVariant)
 *   extraVariant   + pull → « Ajouter chez nous » (pullAddLocalVariantFromPfs)
 *
 * Pour `extraVariant`, l'id PFS de la variante est retrouvé en cherchant dans
 * `ctx.pfsVariants` par (colorRef, variantType) — la source de vérité chargée
 * en tête de `applyPfsVerifyActions`.
 */
async function applyStructuralAction(a: ParsedAction, ctx: ApplyContext): Promise<void> {
  const variantType = a.variantType === "PACK" ? "PACK" : "UNIT";

  if (a.field === "missingVariant") {
    if (a.direction === "push") {
      const res = await pushAddPfsVariantFromLocal(ctx.productId, a.colorRef, variantType);
      if (!res.ok) throw new Error(res.error);
      return;
    }
    // pull → retirer chez nous
    const res = await pullRemoveLocalVariant(ctx.productId, a.colorRef, variantType);
    if (!res.ok) throw new Error(res.error);
    return;
  }

  if (a.field === "extraVariant") {
    // La variante n'existe pas chez nous — on retrouve son id PFS depuis
    // l'état chargé au début de l'apply (ctx.pfsVariants).
    const pv = findPfsVariant(ctx.pfsVariants, a.colorRef, variantType);
    if (!pv) {
      throw new Error(`Variante PFS ${a.colorRef}/${variantType} introuvable — a-t-elle déjà été supprimée ?`);
    }
    if (a.direction === "push") {
      const res = await pushRemovePfsVariant(pv.id);
      if (!res.ok) throw new Error(res.error);
      return;
    }
    // pull → ajouter chez nous
    const res = await pullAddLocalVariantFromPfs(ctx.productId, pv.id);
    if (!res.ok) throw new Error(res.error);
    return;
  }

  throw new Error(`Champ structurel non pris en charge : ${a.field}`);
}
