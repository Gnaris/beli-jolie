"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

// ─────────────────────────────────────────────
// Types partagés client/serveur
// ─────────────────────────────────────────────

export type ClientCardProductPurchaseSource =
  | "PFS"
  | "EFASHION"
  | "ANKORSTORE"
  | "FAIRE"
  | "MICROSTORE"
  | "PASSAGE";

const ALL_SOURCES: ReadonlyArray<ClientCardProductPurchaseSource> = [
  "PFS",
  "EFASHION",
  "ANKORSTORE",
  "FAIRE",
  "MICROSTORE",
  "PASSAGE",
];

function isValidSource(v: string): v is ClientCardProductPurchaseSource {
  return (ALL_SOURCES as ReadonlyArray<string>).includes(v);
}

export interface ColorBreakdown {
  colorId: string;                    // Color.id (regroupe toutes les variantes ProductColor de cette couleur)
  productColorIds: string[];          // ProductColor.id concernés (peut être plusieurs si UNIT+PACK)
  defaultProductColorId: string;      // ProductColor.id à utiliser pour un nouvel ajout (primary d'abord)
  colorName: string;
  colorHex: string | null;
  colorPatternImage: string | null;
  pfsQuantity: number;                // Somme sur toutes les variantes de cette couleur
  purchases: Array<{
    source: ClientCardProductPurchaseSource;
    quantity: number;
    purchaseId: string;               // ID d'une AdminClientCardProductPurchase précise
    productColorId: string;           // Variante concrète pointée
  }>;
  // Vue agrégée par source pour l'affichage rapide (PFS auto + manuel additifs)
  sourceQuantities: Array<{
    source: ClientCardProductPurchaseSource;
    quantity: number;
  }>;
  totalQuantity: number;
}

export interface ClientCardOrderedProduct {
  key: string;
  productId: string | null;
  name: string;
  reference: string;
  category: string | null;
  image: string | null;
  colors: ColorBreakdown[];
  totalQuantity: number;
  sources: ClientCardProductPurchaseSource[];
  lastActivityAt: string | null;
  // Quantité PFS agrégée sur ce produit mais sans couleur reconnue (mapping partiel PFS).
  // Comptée dans totalQuantity, mais non répartie sur les colors[].
  pfsUnmappedColorQuantity: number;
  // True si l'item PFS n'a même pas de produit local mappé (fallback affichage ref-only).
  unmappedProduct: boolean;
}

export interface ListOrderedProductsResult {
  rows: ClientCardOrderedProduct[];
  totalCount: number;
  page: number;
  perPage: number;
  totalPages: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function computeColorTotal(color: ColorBreakdown): number {
  const pfsManualTotal = color.purchases
    .filter((p) => p.source === "PFS")
    .reduce((sum, p) => sum + p.quantity, 0);
  const pfsEffective = Math.max(pfsManualTotal, color.pfsQuantity);
  const others = color.purchases
    .filter((p) => p.source !== "PFS")
    .reduce((sum, p) => sum + p.quantity, 0);
  return pfsEffective + others;
}

function buildSourceQuantities(color: ColorBreakdown): Array<{
  source: ClientCardProductPurchaseSource;
  quantity: number;
}> {
  const map = new Map<ClientCardProductPurchaseSource, number>();
  // PFS = max(auto, saisie manuelle cumulée) car la saisie manuelle sur PFS
  // ne peut pas être inférieure à l'auto (validé en amont).
  const pfsManualTotal = color.purchases
    .filter((p) => p.source === "PFS")
    .reduce((sum, p) => sum + p.quantity, 0);
  const pfsEffective = Math.max(pfsManualTotal, color.pfsQuantity);
  if (pfsEffective > 0) map.set("PFS", pfsEffective);
  for (const p of color.purchases) {
    if (p.source === "PFS") continue;
    map.set(p.source, (map.get(p.source) ?? 0) + p.quantity);
  }
  return Array.from(map.entries())
    .map(([source, quantity]) => ({ source, quantity }))
    .sort((a, b) => b.quantity - a.quantity);
}

// ─────────────────────────────────────────────
// Liste paginée
// ─────────────────────────────────────────────

export async function listOrderedProductsForClientCard(params: {
  adminClientCardId: string;
  page?: number;
  perPage?: number;
  sortBy?: "quantity_desc" | "quantity_asc" | "recent";
}): Promise<ListOrderedProductsResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const page = Math.max(1, Math.floor(params.page ?? 1));
  const perPage = Math.max(1, Math.min(100, Math.floor(params.perPage ?? 20)));
  const sortBy = params.sortBy ?? "recent";
  const { adminClientCardId } = params;

  const cardExists = await prisma.adminClientCard.findFirst({
    where: { tenantId: tenant.id, id: adminClientCardId },
    select: { id: true },
  });
  if (!cardExists) {
    return { rows: [], totalCount: 0, page, perPage, totalPages: 0 };
  }

  // 1) PFS items — on prend TOUT ce qui est rattaché à la fiche, même
  // sans mapping local complet (sinon les commandes anciennes disparaissent).
  const pfsItems = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId: tenant.id,
      pfsOrder: { adminClientCardId, tenantId: tenant.id },
    },
    select: {
      productId: true,
      productColorId: true,
      pfsProductRef: true,
      productSnapshotName: true,
      qtyOrdered: true,
      pfsOrder: { select: { createdAtPfs: true } },
      productColor: {
        select: { saleType: true, packQuantity: true },
      },
      // Fallback : si productColorId est null, on récupère quand même le saleType
      // depuis le product (première couleur primaire) pour le multiplicateur PACK.
      product: {
        select: {
          colors: {
            where: { isPrimary: true, disabled: false },
            take: 1,
            select: { saleType: true, packQuantity: true },
          },
        },
      },
    },
  });

  // 2) Purchases manuelles pour cette fiche
  const purchases = await prisma.adminClientCardProductPurchase.findMany({
    where: { tenantId: tenant.id, adminClientCardId },
    select: {
      id: true,
      productId: true,
      productColorId: true,
      source: true,
      quantity: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // Agrège pfsQuantity par (productId, productColorId)
  const pfsQtyByKey = new Map<string, number>();
  // Quantité PFS mappée sur un produit local mais dont la couleur n'est PAS mappée
  // (agrège au niveau produit uniquement, s'affiche à part).
  const pfsUnmappedColorByProduct = new Map<string, number>();
  // Items PFS sans aucun mapping local — affichés en fallback ref-only
  interface OrphanRow {
    ref: string;
    name: string;
    qty: number;
    lastActivityAt: string | null;
  }
  const pfsOrphanByRef = new Map<string, OrphanRow>();
  const lastActivityByProduct = new Map<string, string>();

  for (const it of pfsItems) {
    const iso = it.pfsOrder?.createdAtPfs?.toISOString() ?? null;

    // Cas 1 : aucun product mappé → item orphelin
    if (!it.productId) {
      const orphanKey = it.pfsProductRef || `orphan-${it.productSnapshotName ?? "?"}`;
      const existing = pfsOrphanByRef.get(orphanKey);
      const mult = 1; // pas de saleType connu, on compte 1 pour 1
      const qty = it.qtyOrdered * mult;
      if (existing) {
        existing.qty += qty;
        if (iso && (!existing.lastActivityAt || iso > existing.lastActivityAt)) {
          existing.lastActivityAt = iso;
        }
      } else {
        pfsOrphanByRef.set(orphanKey, {
          ref: it.pfsProductRef,
          name: it.productSnapshotName ?? it.pfsProductRef,
          qty,
          lastActivityAt: iso,
        });
      }
      continue;
    }

    // À partir d'ici, productId est présent
    if (iso) {
      const prev = lastActivityByProduct.get(it.productId);
      if (!prev || iso > prev) lastActivityByProduct.set(it.productId, iso);
    }

    // Détermine le multiplicateur PACK depuis la variante ; fallback sur la couleur primaire du produit
    const variantMeta = it.productColor ?? it.product?.colors[0] ?? null;
    const mult =
      variantMeta?.saleType === "PACK" && variantMeta.packQuantity
        ? variantMeta.packQuantity
        : 1;
    const qty = it.qtyOrdered * mult;

    // Cas 2 : couleur non mappée → agrège au niveau produit
    if (!it.productColorId) {
      pfsUnmappedColorByProduct.set(
        it.productId,
        (pfsUnmappedColorByProduct.get(it.productId) ?? 0) + qty,
      );
      continue;
    }

    // Cas 3 : mapping complet
    const key = `${it.productId}::${it.productColorId}`;
    pfsQtyByKey.set(key, (pfsQtyByKey.get(key) ?? 0) + qty);
  }

  // Purchases par (productId, productColorId)
  const purchasesByKey = new Map<
    string,
    Array<{
      source: ClientCardProductPurchaseSource;
      quantity: number;
      purchaseId: string;
    }>
  >();
  for (const p of purchases) {
    const key = `${p.productId}::${p.productColorId}`;
    const bucket = purchasesByKey.get(key) ?? [];
    bucket.push({
      source: p.source as ClientCardProductPurchaseSource,
      quantity: p.quantity,
      purchaseId: p.id,
    });
    purchasesByKey.set(key, bucket);
    const iso = (p.updatedAt ?? p.createdAt).toISOString();
    const prev = lastActivityByProduct.get(p.productId);
    if (!prev || iso > prev) lastActivityByProduct.set(p.productId, iso);
  }

  // Ensemble des productIds impliqués
  const productIds = new Set<string>();
  for (const it of pfsItems) if (it.productId) productIds.add(it.productId);
  for (const p of purchases) productIds.add(p.productId);
  if (productIds.size === 0 && pfsOrphanByRef.size === 0) {
    return { rows: [], totalCount: 0, page, perPage, totalPages: 0 };
  }

  // Charge produits + variantes (non-disabled)
  const products = productIds.size === 0
    ? []
    : await prisma.product.findMany({
    where: { id: { in: Array.from(productIds) }, tenantId: tenant.id },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        where: { disabled: false, colorId: { not: null } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isPrimary: true,
          colorId: true,
          color: {
            select: { id: true, name: true, hex: true, patternImage: true },
          },
          images: {
            take: 1,
            orderBy: { order: "asc" },
            select: { path: true },
          },
        },
      },
    },
  });

  const rows: ClientCardOrderedProduct[] = [];

  for (const prod of products) {
    // Image "cover" du produit = image de la première couleur primaire
    let cover: string | null = null;
    for (const c of prod.colors) {
      if (c.images[0]?.path) {
        cover = c.images[0].path;
        break;
      }
    }

    // Regroupe les variantes ProductColor par Color.id (une même couleur
    // peut apparaître sur plusieurs variantes UNIT/PACK — on n'affiche
    // qu'une pastille par couleur unique).
    interface VariantMeta {
      productColorId: string;
      isPrimary: boolean;
    }
    const byColorId = new Map<
      string,
      {
        colorId: string;
        colorName: string;
        colorHex: string | null;
        colorPatternImage: string | null;
        variants: VariantMeta[];
      }
    >();
    for (const c of prod.colors) {
      const cid = c.color?.id;
      if (!cid) continue;
      const bucket = byColorId.get(cid);
      const meta: VariantMeta = { productColorId: c.id, isPrimary: c.isPrimary };
      if (bucket) {
        bucket.variants.push(meta);
      } else {
        byColorId.set(cid, {
          colorId: cid,
          colorName: c.color?.name ?? "—",
          colorHex: c.color?.hex ?? null,
          colorPatternImage: c.color?.patternImage ?? null,
          variants: [meta],
        });
      }
    }

    const colorBreakdowns: ColorBreakdown[] = Array.from(byColorId.values()).map(
      (group) => {
        // Somme pfsQty sur toutes les variantes de la couleur
        let pfsQty = 0;
        const purchases: ColorBreakdown["purchases"] = [];
        for (const v of group.variants) {
          pfsQty += pfsQtyByKey.get(`${prod.id}::${v.productColorId}`) ?? 0;
          const list = purchasesByKey.get(`${prod.id}::${v.productColorId}`) ?? [];
          for (const p of list) {
            purchases.push({
              source: p.source,
              quantity: p.quantity,
              purchaseId: p.purchaseId,
              productColorId: v.productColorId,
            });
          }
        }
        const primaryVariant =
          group.variants.find((v) => v.isPrimary) ?? group.variants[0];
        const breakdown: ColorBreakdown = {
          colorId: group.colorId,
          productColorIds: group.variants.map((v) => v.productColorId),
          defaultProductColorId: primaryVariant.productColorId,
          colorName: group.colorName,
          colorHex: group.colorHex,
          colorPatternImage: group.colorPatternImage,
          pfsQuantity: pfsQty,
          purchases,
          sourceQuantities: [],
          totalQuantity: 0,
        };
        breakdown.totalQuantity = computeColorTotal(breakdown);
        breakdown.sourceQuantities = buildSourceQuantities(breakdown);
        return breakdown;
      },
    );

    const unmappedPfs = pfsUnmappedColorByProduct.get(prod.id) ?? 0;
    const totalQuantity =
      colorBreakdowns.reduce((sum, c) => sum + c.totalQuantity, 0) + unmappedPfs;
    if (totalQuantity <= 0) continue; // Produit jamais vraiment commandé

    const sources = new Set<ClientCardProductPurchaseSource>();
    for (const c of colorBreakdowns) {
      if (c.pfsQuantity > 0) sources.add("PFS");
      for (const p of c.purchases) sources.add(p.source);
    }
    if (unmappedPfs > 0) sources.add("PFS");

    rows.push({
      key: prod.id,
      productId: prod.id,
      name: prod.name,
      reference: prod.reference,
      category: prod.category?.name ?? null,
      image: cover,
      colors: colorBreakdowns,
      totalQuantity,
      sources: Array.from(sources),
      lastActivityAt: lastActivityByProduct.get(prod.id) ?? null,
      pfsUnmappedColorQuantity: unmappedPfs,
      unmappedProduct: false,
    });
  }

  // Injecte les orphelins PFS (aucun produit local mappé) en fallback ref-only
  for (const [key, orphan] of pfsOrphanByRef.entries()) {
    rows.push({
      key: `pfs-ref:${key}`,
      productId: null,
      name: orphan.name,
      reference: orphan.ref,
      category: null,
      image: null,
      colors: [],
      totalQuantity: orphan.qty,
      sources: ["PFS"],
      lastActivityAt: orphan.lastActivityAt,
      pfsUnmappedColorQuantity: orphan.qty,
      unmappedProduct: true,
    });
  }

  // Tri
  rows.sort((a, b) => {
    if (sortBy === "quantity_desc") return b.totalQuantity - a.totalQuantity;
    if (sortBy === "quantity_asc") return a.totalQuantity - b.totalQuantity;
    // recent : par lastActivityAt desc, null en dernier
    const ax = a.lastActivityAt ?? "";
    const bx = b.lastActivityAt ?? "";
    if (!ax && !bx) return 0;
    if (!ax) return 1;
    if (!bx) return -1;
    return bx.localeCompare(ax);
  });

  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const start = (page - 1) * perPage;
  const paged = rows.slice(start, start + perPage);

  return { rows: paged, totalCount, page, perPage, totalPages };
}

// ─────────────────────────────────────────────
// Ajout d'un achat
// ─────────────────────────────────────────────

/**
 * Ajoute un achat (produit × couleur × provenance × quantité) à la fiche.
 * - Résout le produit par référence (case-insensitive, exact).
 * - Vérifie que la couleur appartient bien au produit.
 * - Refuse une quantité ≤ 0.
 * - Si (card × product × color × source) existe déjà : additionne la quantité.
 * - Si source = PFS : refuse si le total devient inférieur à la qty PFS auto.
 */
export async function addPurchaseToClientCard(input: {
  adminClientCardId: string;
  reference: string;
  colorId: string; // Color.id — le server résout vers la ProductColor primaire
  source: ClientCardProductPurchaseSource;
  quantity: number;
}): Promise<{ success: true; productId: string; colorId: string }> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La quantité doit être un nombre supérieur à 0.");
  }
  if (!isValidSource(input.source)) {
    throw new Error("Provenance invalide.");
  }
  const ref = input.reference.trim();
  if (!ref) throw new Error("Référence manquante.");

  const card = await prisma.adminClientCard.findFirst({
    where: { tenantId: tenant.id, id: input.adminClientCardId },
    select: { id: true },
  });
  if (!card) throw new Error("Fiche client introuvable.");

  const product = await prisma.product.findFirst({
    where: {
      tenantId: tenant.id,
      reference: { equals: ref },
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });
  if (!product) throw new Error(`Aucun produit trouvé pour la référence « ${ref} ».`);

  // Résout Color.id → ProductColor.id (primaire de préférence)
  const variants = await prisma.productColor.findMany({
    where: {
      productId: product.id,
      tenantId: tenant.id,
      colorId: input.colorId,
      disabled: false,
    },
    select: { id: true, isPrimary: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  if (variants.length === 0) {
    throw new Error("Cette couleur n'appartient pas au produit sélectionné.");
  }
  const color = variants[0];

  // Existant ?
  const existing = await prisma.adminClientCardProductPurchase.findFirst({
    where: {
      tenantId: tenant.id,
      adminClientCardId: input.adminClientCardId,
      productId: product.id,
      productColorId: color.id,
      source: input.source,
    },
    select: { id: true, quantity: true },
  });

  const newTotalForSource = (existing?.quantity ?? 0) + quantity;

  // Contrainte PFS : le total saisi ne peut pas être < qty PFS auto
  if (input.source === "PFS") {
    const pfsAuto = await computePfsQuantityForColor({
      tenantId: tenant.id,
      adminClientCardId: input.adminClientCardId,
      productId: product.id,
      productColorId: color.id,
    });
    if (newTotalForSource < pfsAuto) {
      throw new Error(
        `La quantité PFS ne peut pas être inférieure à ${pfsAuto} (calculée depuis les commandes PFS déjà importées).`,
      );
    }
  }

  if (existing) {
    await prisma.adminClientCardProductPurchase.update({
      where: { id: existing.id },
      data: { quantity: newTotalForSource, addedById: session.user.id },
    });
  } else {
    await prisma.adminClientCardProductPurchase.create({
      data: {
        tenantId: tenant.id,
        adminClientCardId: input.adminClientCardId,
        productId: product.id,
        productColorId: color.id,
        source: input.source,
        quantity,
        addedById: session.user.id,
      },
    });
  }

  revalidatePath("/admin/clients");
  return { success: true as const, productId: product.id, colorId: color.id };
}

// ─────────────────────────────────────────────
// Édition d'un achat
// ─────────────────────────────────────────────

export async function updatePurchase(input: {
  purchaseId: string;
  source: ClientCardProductPurchaseSource;
  quantity: number;
}): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("La quantité doit être un nombre supérieur à 0.");
  }
  if (!isValidSource(input.source)) {
    throw new Error("Provenance invalide.");
  }

  const current = await prisma.adminClientCardProductPurchase.findFirst({
    where: { tenantId: tenant.id, id: input.purchaseId },
    select: {
      id: true,
      adminClientCardId: true,
      productId: true,
      productColorId: true,
      source: true,
    },
  });
  if (!current) throw new Error("Entrée introuvable.");

  // Contrainte PFS (sur source résultante)
  if (input.source === "PFS") {
    const pfsAuto = await computePfsQuantityForColor({
      tenantId: tenant.id,
      adminClientCardId: current.adminClientCardId,
      productId: current.productId,
      productColorId: current.productColorId,
    });
    // Si la source change vers PFS, on ne compte pas l'ancienne ligne — c'est
    // la nouvelle qty seule (ou fusionnée si conflit) qui compte.
    // Si conflit (autre ligne PFS existante), on additionnera → fusion.
    let effectiveQty = quantity;
    if (current.source !== "PFS") {
      const conflict = await prisma.adminClientCardProductPurchase.findFirst({
        where: {
          tenantId: tenant.id,
          adminClientCardId: current.adminClientCardId,
          productId: current.productId,
          productColorId: current.productColorId,
          source: "PFS",
        },
        select: { quantity: true },
      });
      effectiveQty = quantity + (conflict?.quantity ?? 0);
    }
    if (effectiveQty < pfsAuto) {
      throw new Error(
        `La quantité PFS ne peut pas être inférieure à ${pfsAuto} (calculée depuis les commandes PFS déjà importées).`,
      );
    }
  }

  // Cas fusion : si on change la source vers une source qui existe déjà pour ce
  // (card × product × color), on fusionne en additionnant.
  if (input.source !== current.source) {
    const conflict = await prisma.adminClientCardProductPurchase.findFirst({
      where: {
        tenantId: tenant.id,
        adminClientCardId: current.adminClientCardId,
        productId: current.productId,
        productColorId: current.productColorId,
        source: input.source,
        NOT: { id: current.id },
      },
      select: { id: true, quantity: true },
    });
    if (conflict) {
      await prisma.$transaction([
        prisma.adminClientCardProductPurchase.update({
          where: { id: conflict.id },
          data: { quantity: conflict.quantity + quantity },
        }),
        prisma.adminClientCardProductPurchase.delete({
          where: { id: current.id },
        }),
      ]);
      revalidatePath("/admin/clients");
      return { success: true as const };
    }
  }

  await prisma.adminClientCardProductPurchase.update({
    where: { id: current.id },
    data: { source: input.source, quantity },
  });

  revalidatePath("/admin/clients");
  return { success: true as const };
}

// ─────────────────────────────────────────────
// Suppression d'un achat
// ─────────────────────────────────────────────

export async function deletePurchase(
  purchaseId: string,
): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const entry = await prisma.adminClientCardProductPurchase.findFirst({
    where: { tenantId: tenant.id, id: purchaseId },
    select: { id: true },
  });
  if (!entry) throw new Error("Entrée introuvable.");

  await prisma.adminClientCardProductPurchase.delete({ where: { id: entry.id } });

  revalidatePath("/admin/clients");
  return { success: true as const };
}

// ─────────────────────────────────────────────
// Lookup produit par référence (exact, case-insensitive)
// ─────────────────────────────────────────────

export interface ProductLookupResult {
  id: string;
  name: string;
  reference: string;
  category: string;
  colors: Array<{
    id: string;                    // Color.id (unique par couleur, pas par variante)
    productColorIds: string[];     // ProductColor.id concernés
    name: string;
    hex: string | null;
    patternImage: string | null;
    image: string | null;
  }>;
}

export async function lookupProductByReference(
  reference: string,
): Promise<ProductLookupResult | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const ref = reference.trim();
  if (!ref) return null;

  const product = await prisma.product.findFirst({
    where: {
      tenantId: tenant.id,
      reference: { equals: ref },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        where: { disabled: false, colorId: { not: null } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isPrimary: true,
          color: {
            select: { id: true, name: true, hex: true, patternImage: true },
          },
          images: {
            take: 1,
            orderBy: { order: "asc" },
            select: { path: true },
          },
        },
      },
    },
  });

  if (!product) return null;

  // Regroupe par Color.id
  const grouped = new Map<
    string,
    ProductLookupResult["colors"][number]
  >();
  for (const c of product.colors) {
    const cid = c.color?.id;
    if (!cid) continue;
    const existing = grouped.get(cid);
    const img = c.images[0]?.path ?? null;
    if (existing) {
      existing.productColorIds.push(c.id);
      if (!existing.image && img) existing.image = img;
    } else {
      grouped.set(cid, {
        id: cid,
        productColorIds: [c.id],
        name: c.color?.name ?? "—",
        hex: c.color?.hex ?? null,
        patternImage: c.color?.patternImage ?? null,
        image: img,
      });
    }
  }

  return {
    id: product.id,
    name: product.name,
    reference: product.reference,
    category: product.category?.name ?? "",
    colors: Array.from(grouped.values()),
  };
}

// ─────────────────────────────────────────────
// Recherche autocomplete (min 2 chars, top 10)
// ─────────────────────────────────────────────

export interface ProductSearchResult {
  id: string;
  name: string;
  reference: string;
  category: string;
  image: string | null;
}

export async function searchProductsForClientCard(
  query: string,
): Promise<ProductSearchResult[]> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const q = query.trim();
  if (q.length < 2) return [];

  const products = await prisma.product.findMany({
    where: {
      tenantId: tenant.id,
      status: { not: "ARCHIVED" },
      OR: [{ name: { contains: q } }, { reference: { contains: q } }],
    },
    select: {
      id: true,
      name: true,
      reference: true,
      category: { select: { name: true } },
      colors: {
        where: { disabled: false },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: {
          images: {
            take: 1,
            orderBy: { order: "asc" },
            select: { path: true },
          },
        },
      },
    },
    take: 10,
    orderBy: { name: "asc" },
  });

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    category: p.category?.name ?? "",
    image: p.colors[0]?.images[0]?.path ?? null,
  }));
}

// ─────────────────────────────────────────────
// Interne : recalcule la qty PFS auto d'une (fiche × produit × couleur)
// ─────────────────────────────────────────────

async function computePfsQuantityForColor(args: {
  tenantId: string;
  adminClientCardId: string;
  productId: string;
  productColorId: string;
}): Promise<number> {
  // Résout Color.id de la variante cible puis somme sur TOUTES les variantes
  // (UNIT + PACK) portant la même Color pour ce produit — cohérent avec
  // l'affichage groupé par couleur.
  const target = await prisma.productColor.findFirst({
    where: {
      id: args.productColorId,
      productId: args.productId,
      tenantId: args.tenantId,
    },
    select: { colorId: true },
  });
  const colorId = target?.colorId ?? null;
  const items = await prisma.pfsOrderItem.findMany({
    where: {
      tenantId: args.tenantId,
      productId: args.productId,
      // Si colorId est connu, on somme sur toutes les variantes portant cette Color.
      // Sinon on retombe sur la variante cible seule.
      productColor: colorId ? { colorId } : undefined,
      productColorId: colorId ? undefined : args.productColorId,
      pfsOrder: {
        tenantId: args.tenantId,
        adminClientCardId: args.adminClientCardId,
      },
    },
    select: {
      qtyOrdered: true,
      productColor: { select: { saleType: true, packQuantity: true } },
    },
  });
  let total = 0;
  for (const it of items) {
    const mult =
      it.productColor?.saleType === "PACK" && it.productColor.packQuantity
        ? it.productColor.packQuantity
        : 1;
    total += it.qtyOrdered * mult;
  }
  return total;
}
