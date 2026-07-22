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
import { getPfsOutOfStockConfig } from "@/lib/pfs-out-of-stock-config";
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
import { Prisma } from "@prisma/client";

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
  errors: { key: string; error: string }[];
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
  outOfStockAction: "archived" | "deleted" | "draft";
  deactivateOnZeroStock: boolean;
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
  const variantsResp = await pfsGetVariants(checkRef.product.id);

  const [markupConfigs, outOfStockCfg] = await Promise.all([
    loadMarketplaceMarkupConfigs(),
    getPfsOutOfStockConfig(),
  ]);

  const ctx: ApplyContext = {
    productId,
    pfsProductId: local.pfsProductId,
    local,
    pfsProduct: checkRef.product,
    pfsVariants: variantsResp.data ?? [],
    markup: markupConfigs.pfs,
    outOfStockAction: outOfStockCfg.productAction,
    deactivateOnZeroStock: outOfStockCfg.deactivateVariant,
  };

  const productPullActions: ParsedAction[] = [];
  const variantPullActions: ParsedAction[] = [];
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
    (parsed.scope === "product" ? productPullActions : variantPullActions).push(entry);
  }

  const pullLocalPatch: LocalPatch = { product: {}, variants: new Map() };
  for (const a of productPullActions) {
    try {
      buildProductPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
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

  const hadPull = report.applied.length > 0;
  if (hadPull) {
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
  const variantsResp = await pfsGetVariants(checkRef.product.id);

  const [markupConfigs, outOfStockCfg] = await Promise.all([
    loadMarketplaceMarkupConfigs(),
    getPfsOutOfStockConfig(),
  ]);

  const ctx: ApplyContext = {
    productId,
    pfsProductId: local.pfsProductId,
    local,
    pfsProduct: checkRef.product,
    pfsVariants: variantsResp.data ?? [],
    markup: markupConfigs.pfs,
    outOfStockAction: outOfStockCfg.productAction,
    deactivateOnZeroStock: outOfStockCfg.deactivateVariant,
  };

  // ── PHASE 1 : Trier + valider ───────────────────────────────────────────
  const productPushActions: ParsedAction[] = [];
  const productPullActions: ParsedAction[] = [];
  const variantPushActions: ParsedAction[] = [];
  const variantPullActions: ParsedAction[] = [];

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
    if (parsed.scope === "product") {
      (a.direction === "push" ? productPushActions : productPullActions).push(entry);
    } else {
      (a.direction === "push" ? variantPushActions : variantPullActions).push(entry);
    }
  }

  // ── PHASE 2 : Appliquer les PULLs (local → BDD) ─────────────────────────
  // On les fait d'abord : plus sûr pour l'utilisatrice si un push échoue.
  const pullLocalPatch: LocalPatch = { product: {}, variants: new Map() };

  for (const a of productPullActions) {
    try {
      buildProductPullPatch(a, ctx, pullLocalPatch);
      report.applied.push({ key: a.rawKey, direction: "pull" });
    } catch (err) {
      report.errors.push({ key: a.rawKey, error: humanizeError(err) });
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

  const hadPull = report.applied.some((a) => a.direction === "pull");
  if (hadPull) {
    await commitLocalPatch(productId, local, pullLocalPatch);
  }

  // ── PHASE 3 : Appliquer les PUSHs (local → PFS) ─────────────────────────
  // On repart d'un state local frais (celui après les pulls) pour lire
  // les valeurs à envoyer.
  const freshLocal = hadPull ? await loadProductWithVariants(productId) : local;
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
  }>;
  variants: Map<
    string,
    Partial<{ unitPrice: number; stock: number; weight: number; disabled: boolean }>
  >;
}

function buildProductPullPatch(a: ParsedAction, ctx: ApplyContext, patch: LocalPatch): void {
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
      // /ARCHIVED). READY_FOR_SALE + NEW → ONLINE, DRAFT → OFFLINE, ARCHIVED
      // /DELETED → ARCHIVED. On ne remonte jamais en SYNCING (transitoire).
      if (raw === "READY_FOR_SALE" || raw === "NEW") patch.product.status = "ONLINE";
      else if (raw === "DRAFT") patch.product.status = "OFFLINE";
      else if (raw === "ARCHIVED" || raw === "DELETED") patch.product.status = "ARCHIVED";
      else throw new Error(`Statut PFS inconnu : ${raw}`);
      return;
    }
    default:
      throw new Error(`Champ produit non supporté (pull) : ${a.field}`);
  }
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
      existing.stock = Number(pv.stock_qty ?? 0);
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
    if (Object.keys(patch.product).length > 0 || Object.keys(otherMarketplaceFlags).length > 0) {
      await tx.product.update({ where: { id: productId }, data: productData });
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
    const allZero = local.colors.every((c) => (c.stock ?? 0) <= 0);
    const target = mapLocalToPfsStatus(local.status, allZero, ctx.outOfStockAction);
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
