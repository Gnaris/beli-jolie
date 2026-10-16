"use server";

/**
 * Création d'une commande par l'admin « pour » une cliente, depuis
 * /admin/clients/[id]/nouvelle-commande (menu Actions → « Créer une commande »).
 *
 * Flux :
 *   1. L'admin ajoute des articles + ajuste les prix librement.
 *   2. La commande est créée en « draft admin » (isAdminDraft=true),
 *      paymentStatus="pending", paymentMode=null. Stock réservé immédiatement.
 *   3. La cliente la voit dans /espace-pro/commandes avec badge
 *      « À finaliser et payer ».
 *   4. Elle finalise (adresse + livraison + paiement) via /espace-pro/
 *      commandes/[id]/finaliser → action `finalizeAdminOrder`.
 *
 * NOTE scope MVP : support UNIT only (une couleur, taille optionnelle, qty).
 * Les variantes PACK peuvent être ajoutées mais sans détail multi-couleurs —
 * elles sont traitées comme un pack unitaire.
 */

import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { resolveVatRate } from "@/lib/vat";
import { logger } from "@/lib/logger";

export interface AdminOrderLineInput {
  variantId: string; // ProductColor.id
  sizeId: string | null; // Size.id ou null si TU / variant mono-taille
  quantity: number; // en unités (ou paquets pour PACK)
  unitPrice: number; // prix unitaire HT fixé par l'admin
}

export interface CreateAdminOrderInput {
  clientId: string;
  items: AdminOrderLineInput[];
}

export type CreateAdminOrderResult =
  | { success: true; orderId: string; orderNumber: string }
  | { success: false; error: string };

async function generateOrderNumber(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const generate = () => {
    let id = "";
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  };
  let orderNumber: string;
  let exists = true;
  do {
    orderNumber = generate();
    const found = await prisma.order.findFirst({
      where: { orderNumber },
      select: { id: true },
    });
    exists = !!found;
  } while (exists);
  return orderNumber;
}

function roundCent(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createAdminOrderForClient(
  input: CreateAdminOrderInput,
): Promise<CreateAdminOrderResult> {
  try {
    const { session } = await requireAdmin();

    // 1. Charger la cliente destinataire
    const client = await prisma.user.findUnique({
      where: { id: input.clientId },
    });
    if (!client) return { success: false, error: "Client introuvable." };
    if (client.role === "ADMIN") {
      return { success: false, error: "Impossible de créer une commande pour un admin." };
    }

    // 2. Validation des lignes
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return { success: false, error: "Ajoutez au moins un article." };
    }
    for (const item of input.items) {
      if (!item.variantId) return { success: false, error: "Variante manquante." };
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        return { success: false, error: "La quantité doit être supérieure à 0." };
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
        return { success: false, error: "Le prix unitaire doit être positif ou nul." };
      }
    }

    // 3. Charger les variantes
    const variantIds = Array.from(new Set(input.items.map((i) => i.variantId)));
    const variants = await prisma.productColor.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            reference: true,
            category: { select: { name: true } },
          },
        },
        color: { select: { name: true, hex: true } },
        variantSizes: { include: { size: true } },
      },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    for (const item of input.items) {
      const v = variantMap.get(item.variantId);
      if (!v) return { success: false, error: "Variante introuvable." };
      if (v.disabled) {
        return { success: false, error: `Variante désactivée (${v.product.reference}).` };
      }
    }

    // 4. Snapshots i18n du nom produit (survient si on supprime le produit)
    const productIds = Array.from(new Set(variants.map((v) => v.product.id)));
    const translations = await prisma.productTranslation.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, locale: true, name: true },
    });
    const i18nByProduct = new Map<string, Record<string, string>>();
    for (const r of translations) {
      const n = r.name?.trim();
      if (!n) continue;
      const cur = i18nByProduct.get(r.productId) ?? {};
      cur[r.locale] = n;
      i18nByProduct.set(r.productId, cur);
    }

    // 5. Charger les images (ProductColorImage, prioriser order asc)
    const pairs = [
      ...new Map(
        variants
          .filter((v) => v.colorId != null)
          .map((v) => [`${v.product.id}__${v.colorId}`, { productId: v.product.id, colorId: v.colorId! }]),
      ).values(),
    ];
    const allImages = pairs.length > 0
      ? await prisma.productColorImage.findMany({
          where: { OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })) },
          orderBy: { order: "asc" },
        })
      : [];
    const imagesByKey = new Map<string, string>();
    for (const img of allImages) {
      const key = `${img.productId}__${img.colorId}`;
      if (!imagesByKey.has(key)) imagesByKey.set(key, img.path);
    }

    // 6. Préparer les lignes OrderItem + totals
    const orderItemsData = input.items.map((item) => {
      const variant = variantMap.get(item.variantId)!;
      const lineTotal = roundCent(item.unitPrice * item.quantity);
      const sz = item.sizeId
        ? variant.variantSizes.find((vs) => vs.sizeId === item.sizeId) ?? null
        : null;
      const sizesJson = sz
        ? JSON.stringify([{ name: sz.size.name, quantity: item.quantity }])
        : variant.variantSizes.length === 1
          ? JSON.stringify([{ name: variant.variantSizes[0].size.name, quantity: item.quantity }])
          : null;
      const imgKey = `${variant.product.id}__${variant.colorId ?? ""}`;
      const i18n = i18nByProduct.get(variant.product.id) ?? null;

      return {
        variant,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal,
        sizeId: item.sizeId ?? null,
        itemData: {
          productName: variant.product.name,
          productNameI18n: i18n && Object.keys(i18n).length > 0 ? i18n : undefined,
          productRef: variant.product.reference,
          colorName: variant.color?.name ?? "",
          saleType: variant.saleType,
          packQty: variant.packQuantity ?? null,
          size: null,
          sizesJson,
          packDetails: null,
          imagePath: imagesByKey.get(imgKey) ?? null,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          lineTotal,
          variantSnapshot: JSON.stringify({
            productColorId: variant.id,
            productName: variant.product.name,
            productRef: variant.product.reference,
            colorName: variant.color?.name ?? "",
            colorHex: variant.color?.hex ?? null,
            saleType: variant.saleType,
            packQuantity: variant.packQuantity,
            sizeName: sz?.size.name ?? null,
          }),
        },
      };
    });

    const subtotalHT = roundCent(orderItemsData.reduce((s, l) => s + l.lineTotal, 0));
    const tvaRate = resolveVatRate({
      countryCode: client.addressCountry,
      deliveryMode: "delivery",
      vatExempt: client.vatExempt ?? false,
      domTomCertified: false,
    });

    // 7. Snapshot adresse livraison depuis la fiche cliente (placeholder,
    //    remplaçable au moment du finalize côté client).
    const shipAddress1 = client.addressStreet ?? "";
    const shipZipCode = client.addressZip ?? "";
    const shipCity = client.addressCity ?? "";
    const shipCountry = client.addressCountry ?? "FR";

    const orderNumber = await generateOrderNumber();

    // 8. Transaction : décrémenter stock + créer commande + stock movements.
    //    updateMany conditionnel (where stock >= qty) = atomique côté MySQL.
    const result = await prisma.$transaction(async (tx) => {
      for (const line of orderItemsData) {
        const units =
          line.variant.saleType === "PACK"
            ? (line.variant.packQuantity ?? 1) * line.quantity
            : line.quantity;
        const upd = await tx.productColor.updateMany({
          where: { id: line.variant.id, stock: { gte: units } },
          data: { stock: { decrement: units } },
        });
        if (upd.count === 0) {
          const fresh = await tx.productColor.findUnique({
            where: { id: line.variant.id },
            select: { stock: true },
          });
          const label = line.variant.product.reference ?? line.variant.product.name;
          throw new Error(
            `Stock insuffisant pour « ${label} » : ${fresh?.stock ?? 0} dispo, ${units} demandé(s).`,
          );
        }
      }

      const created = await tx.order.create({
        data: {
          orderNumber,
          userId: client.id,
          status: "PENDING",
          // Flag drafté par l'admin
          isAdminDraft: true,
          adminDraftCreatedById: session.user.id,
          // Paiement en attente — mode choisi par la cliente au finalize
          paymentStatus: "pending",
          paymentMode: null,
          // Livraison (préréglages — la cliente peut remplacer au finalize)
          shipLabel: client.company,
          shipFirstName: client.firstName,
          shipLastName: client.lastName,
          shipCompany: client.company,
          shipAddress1,
          shipAddress2: null,
          shipZipCode,
          shipCity,
          shipCountry,
          // Snapshot client
          clientCompany: client.company,
          clientEmail: client.email,
          clientPhone: client.phone,
          clientSiret: client.siret ?? null,
          clientVatNumber: client.vatNumber ?? null,
          // Transporteur : placeholder, choisi au finalize
          carrierId: "pending_choice",
          carrierName: "À choisir par la cliente",
          carrierPrice: 0,
          carrierBasePrice: 0,
          carrierPromoDiscount: 0,
          carrierClientDiscount: 0,
          // TVA (approximation sans port — recomputé au finalize)
          tvaRate,
          subtotalHT,
          subtotalBrutHT: subtotalHT,
          promoAutoDiscount: 0,
          tvaAmount: roundCent(subtotalHT * tvaRate),
          totalTTC: roundCent(subtotalHT * (1 + tvaRate)),
          items: {
            create: orderItemsData.map((l) => l.itemData),
          },
        },
      });

      await tx.stockMovement.createMany({
        data: orderItemsData.map((l) => ({
          productColorId: l.variant.id,
          sizeId: l.sizeId ?? null,
          quantity: -(
            l.variant.saleType === "PACK"
              ? (l.variant.packQuantity ?? 1) * l.quantity
              : l.quantity
          ),
          type: "ORDER" as const,
          orderId: created.id,
          reason: `Commande admin pour ${client.firstName} ${client.lastName} (${orderNumber})`,
          createdById: session.user.id,
        })),
      });

      return created;
    });

    // 9. Revalider les caches qui listent les commandes
    revalidateTag("admin-dashboard", "default");

    return { success: true, orderId: result.id, orderNumber: result.orderNumber };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur serveur.";
    logger.error("[createAdminOrderForClient] Erreur", { error: err as Error });
    return { success: false, error: msg };
  }
}

// ─── Recherche produits pour le picker ──────────────────────────────────────

export interface AdminOrderVariantOption {
  id: string; // ProductColor.id
  colorName: string;
  colorHex: string | null;
  stock: number;
  unitPrice: number; // prix catalogue (HT)
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizes: { id: string; name: string; quantity: number }[]; // VariantSize
}

export interface AdminOrderProductResult {
  id: string;
  name: string;
  reference: string;
  imagePath: string | null;
  variants: AdminOrderVariantOption[];
}

export async function searchProductsForAdminOrder(
  query: string,
): Promise<{ success: true; results: AdminOrderProductResult[] } | { success: false; error: string }> {
  try {
    const { tenant } = await requireAdmin();
    const trimmed = query.trim();
    if (trimmed.length < 2) return { success: true, results: [] };

    const products = await prisma.product.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: ["ONLINE", "OFFLINE"] },
        OR: [
          { name: { contains: trimmed } },
          { reference: { contains: trimmed } },
        ],
      },
      take: 15,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        reference: true,
        colors: {
          where: { disabled: false },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            saleType: true,
            packQuantity: true,
            stock: true,
            unitPrice: true,
            color: { select: { name: true, hex: true } },
            variantSizes: {
              select: { sizeId: true, quantity: true, size: { select: { name: true } } },
            },
            images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
          },
        },
      },
    });

    const results: AdminOrderProductResult[] = products.map((p) => {
      const firstImage = p.colors[0]?.images[0]?.path ?? null;
      return {
        id: p.id,
        name: p.name,
        reference: p.reference,
        imagePath: firstImage,
        variants: p.colors.map((c) => ({
          id: c.id,
          colorName: c.color?.name ?? "",
          colorHex: c.color?.hex ?? null,
          stock: c.stock,
          unitPrice: Number(c.unitPrice),
          saleType: c.saleType,
          packQuantity: c.packQuantity ?? null,
          sizes: c.variantSizes.map((vs) => ({
            id: vs.sizeId,
            name: vs.size.name,
            quantity: vs.quantity,
          })),
        })),
      };
    });

    return { success: true, results };
  } catch (err) {
    logger.error("[searchProductsForAdminOrder]", { error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}
