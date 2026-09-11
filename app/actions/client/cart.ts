"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentTenantId } from "@/lib/tenant";
import { bumpAbandonedCartTimer } from "@/lib/abandoned-cart-trigger";
import {
  findMissingAddressFields,
  serializeMissingFields,
} from "@/lib/shipping-address-validate";

/**
 * Déclenche la mise à jour du timer de relance panier abandonné.
 * Fire-and-forget : les erreurs internes du trigger ne cassent jamais la
 * mutation panier utilisateur (elles sont loggées côté helper).
 * Skip silencieusement si aucun tenant résolu (script CLI, appel hors requête).
 */
async function fireAbandonedCartTrigger(userId: string): Promise<void> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  await bumpAbandonedCartTimer(userId, tenantId);
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function requireClient() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non authentifié.");
  // ADMIN passe (elle teste son propre tunnel commande de bout en bout).
  // Sinon exiger un CLIENT APPROVED : PENDING/REJECTED ne doit pas pouvoir
  // manipuler son panier — middleware bloque /panier mais pas les server
  // actions appelées en direct.
  if (session.user.role !== "ADMIN") {
    if (session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
      throw new Error("Votre compte n'est pas encore approuvé pour commander.");
    }
  }
  return session.user.id;
}

/** Récupère ou crée le panier de l'utilisateur */
async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

// ─────────────────────────────────────────────
// Lecture du panier (données complètes)
// ─────────────────────────────────────────────

export async function getCart() {
  const userId = await requireClient();

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  reference: true,
                  status: true,
                  discountPercent: true,
                  category: { select: { name: true } },
                },
              },
              color: { select: { id: true, name: true, hex: true, patternImage: true } },
              variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
              packLines: {
                orderBy: { position: "asc" },
                select: {
                  color: { select: { name: true, hex: true, patternImage: true } },
                  sizes: { select: { size: { select: { name: true } }, quantity: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cart) return null;

  // Fetch images per (productId, colorId) pair
  const pairs = [
    ...new Map(
      cart.items
        .filter((item) => item.variant.colorId != null)
        .map((item) => [
          `${item.variant.productId}__${item.variant.colorId}`,
          { productId: item.variant.productId, colorId: item.variant.colorId! },
        ])
    ).values(),
  ];

  const images = pairs.length > 0 ? await prisma.productColorImage.findMany({
    where: {
      OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })),
    },
    orderBy: { order: "asc" },
    select: { productId: true, colorId: true, path: true, order: true },
  }) : [];

  // Group images by "productId__colorId"
  const imagesByKey = new Map<string, typeof images>();
  for (const img of images) {
    const key = `${img.productId}__${img.colorId}`;
    const list = imagesByKey.get(key) ?? [];
    list.push(img);
    imagesByKey.set(key, list);
  }

  // Attach first image to each item + transform variantSizes → sizes
  const itemsWithImages = cart.items.map((item) => {
    const key = `${item.variant.productId}__${item.variant.colorId}`;
    const imgs = imagesByKey.get(key) ?? [];
    const { variantSizes, packLines, ...variantRest } = item.variant;
    const isMultiPack = item.variant.saleType === "PACK" && packLines.length > 0;
    // Pour multi-couleurs : sizes = somme par taille (toutes couleurs confondues)
    const sizes = isMultiPack
      ? (() => {
          const map = new Map<string, { name: string; quantity: number }>();
          for (const line of packLines) {
            for (const s of line.sizes) {
              const cur = map.get(s.size.name);
              if (cur) cur.quantity += s.quantity;
              else map.set(s.size.name, { name: s.size.name, quantity: s.quantity });
            }
          }
          return [...map.values()];
        })()
      : (variantSizes ?? []).map((vs) => ({ name: vs.size.name, quantity: vs.quantity }));
    return {
      ...item,
      variant: {
        ...variantRest,
        sizes,
        packLines: packLines.map((l) => ({
          colorName: l.color?.name ?? "",
          colorHex: l.color?.hex ?? null,
          colorPatternImage: l.color?.patternImage ?? null,
          sizes: l.sizes.map((s) => ({ name: s.size.name, quantity: s.quantity })),
        })),
      },
      variantImages: imgs,
    };
  });

  return { ...cart, items: itemsWithImages };
}

// ─────────────────────────────────────────────
// Lecture enrichie : cart + TOUTES les variantes disponibles par produit
// (utilisée par la page /panier pour afficher les couleurs non commandées à qté 0)
// ─────────────────────────────────────────────

export async function getCartWithProductVariants() {
  const cart = await getCart();
  if (!cart) return { cart: null, productsMeta: {} as Record<string, ProductMeta> };

  const productIds = [...new Set(cart.items.map((item) => item.variant.productId))];
  if (productIds.length === 0) return { cart, productsMeta: {} };

  // Toutes les variantes ProductColor de ces produits, même celles non commandées
  const allVariants = await prisma.productColor.findMany({
    where: { productId: { in: productIds } },
    select: {
      id: true,
      productId: true,
      colorId: true,
      saleType: true,
      packQuantity: true,
      unitPrice: true,
      stock: true,
      color: { select: { id: true, name: true, hex: true, patternImage: true } },
      variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
      packLines: {
        orderBy: { position: "asc" },
        select: {
          color: { select: { name: true, hex: true, patternImage: true } },
          sizes: { select: { size: { select: { name: true } }, quantity: true } },
        },
      },
    },
    orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
  });

  // Images par (productId, colorId) pour toutes les variantes
  const pairs = [
    ...new Map(
      allVariants
        .filter((v) => v.colorId != null)
        .map((v) => [
          `${v.productId}__${v.colorId}`,
          { productId: v.productId, colorId: v.colorId! },
        ])
    ).values(),
  ];
  const images = pairs.length > 0 ? await prisma.productColorImage.findMany({
    where: { OR: pairs.map((p) => ({ productId: p.productId, colorId: p.colorId })) },
    orderBy: { order: "asc" },
    select: { productId: true, colorId: true, path: true },
  }) : [];
  const firstImageByPair = new Map<string, string>();
  for (const img of images) {
    const key = `${img.productId}__${img.colorId}`;
    if (!firstImageByPair.has(key)) firstImageByPair.set(key, img.path);
  }

  const productsMeta: Record<string, ProductMeta> = {};
  for (const pid of productIds) {
    const productVariants = allVariants.filter((v) => v.productId === pid);
    const firstItem = cart.items.find((item) => item.variant.productId === pid);
    if (!firstItem) continue;

    productsMeta[pid] = {
      productId: pid,
      productName: firstItem.variant.product.name,
      productReference: firstItem.variant.product.reference,
      categoryName: firstItem.variant.product.category.name,
      discountPercent: firstItem.variant.product.discountPercent != null
        ? Number(firstItem.variant.product.discountPercent)
        : null,
      mainImagePath: firstItem.variantImages[0]?.path ?? null,
      variants: productVariants.map((v) => {
        const isMultiPack = v.saleType === "PACK" && v.packLines.length > 0;
        const key = `${v.productId}__${v.colorId}`;
        return {
          variantId: v.id,
          colorId: v.colorId,
          colorName: v.color?.name ?? "",
          colorHex: v.color?.hex ?? null,
          colorPatternImage: v.color?.patternImage ?? null,
          saleType: v.saleType,
          packQuantity: v.packQuantity,
          unitPrice: Number(v.unitPrice),
          stock: Number(v.stock),
          isMultiColorPack: isMultiPack,
          firstImagePath: firstImageByPair.get(key) ?? null,
        };
      }),
    };
  }

  return { cart, productsMeta };
}

export interface ProductVariantMeta {
  variantId: string;
  colorId: string | null;
  colorName: string;
  colorHex: string | null;
  colorPatternImage: string | null;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  unitPrice: number;
  stock: number;
  isMultiColorPack: boolean;
  firstImagePath: string | null;
}

export interface ProductMeta {
  productId: string;
  productName: string;
  productReference: string;
  categoryName: string;
  discountPercent: number | null;
  mainImagePath: string | null;
  variants: ProductVariantMeta[];
}

// ─────────────────────────────────────────────
// Wrapper 100 % sérialisable pour le wizard /panier — retourne un objet
// composé uniquement de primitives (number, string, null). À utiliser depuis
// un composant client : `getCartWithProductVariants` renvoie des Decimal
// Prisma que React refuse d'envoyer aux Client Components.
// ─────────────────────────────────────────────

export interface SerializedCartForWizard {
  cart: {
    id: string;
    items: {
      id: string;
      quantity: number;
      variant: {
        id: string;
        productId: string;
        colorId: string | null;
        unitPrice: number;
        weight: number;
        stock: number;
        saleType: "UNIT" | "PACK";
        packQuantity: number | null;
        product: {
          id: string;
          name: string;
          reference: string;
          status: string;
          discountPercent: number | null;
          category: { name: string };
        };
      };
    }[];
  } | null;
  productsMeta: Record<string, ProductMeta>;
}

export async function getSerializedCartForWizard(): Promise<SerializedCartForWizard> {
  const { cart, productsMeta } = await getCartWithProductVariants();
  if (!cart) return { cart: null, productsMeta };

  return {
    cart: {
      id: cart.id,
      items: cart.items.map((item) => ({
        id:       item.id,
        quantity: item.quantity,
        variant: {
          id:           item.variant.id,
          productId:    item.variant.productId,
          colorId:      item.variant.colorId ?? null,
          unitPrice:    Number(item.variant.unitPrice),
          weight:       Number(item.variant.weight),
          stock:        Number(item.variant.stock),
          saleType:     item.variant.saleType,
          packQuantity: item.variant.packQuantity ?? null,
          product: {
            id:              item.variant.product.id,
            name:            item.variant.product.name,
            reference:       item.variant.product.reference,
            status:          item.variant.product.status,
            discountPercent: item.variant.product.discountPercent != null
                               ? Number(item.variant.product.discountPercent)
                               : null,
            category:        { name: item.variant.product.category.name },
          },
        },
      })),
    },
    productsMeta,
  };
}

// ─────────────────────────────────────────────
// Handler unifié : set quantité pour une variante (0 = supprime, N = crée/update)
// Utilisé par la nouvelle UI accordion pour ajouter une couleur non-commandée à la volée.
// ─────────────────────────────────────────────

export async function setCartItemQuantity(variantId: string, quantity: number) {
  const userId = await requireClient();

  if (!Number.isFinite(quantity) || quantity < 0) {
    return { success: false as const, error: "Quantité invalide." };
  }

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, variantId },
  });

  // Quantité 0 = suppression si présente
  if (quantity === 0) {
    if (existing) {
      await prisma.cartItem.delete({ where: { id: existing.id } });
      revalidatePath("/panier");
      await fireAbandonedCartTrigger(userId);
    }
    return { success: true as const, quantity: 0, capped: false };
  }

  // Vérifier statut produit + stock
  const variant = await prisma.productColor.findUnique({
    where: { id: variantId },
    select: {
      stock: true,
      saleType: true,
      packQuantity: true,
      product: { select: { status: true } },
    },
  });
  if (!variant) return { success: false as const, error: "Variante introuvable." };
  if (variant.product.status !== "ONLINE") {
    return { success: false as const, error: "Ce produit n'est plus disponible à la vente." };
  }

  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
    ? Math.floor(variant.stock / variant.packQuantity)
    : variant.stock;

  if (effectiveStock <= 0) {
    return { success: false as const, error: "Stock épuisé." };
  }

  const cappedQty = Math.min(Math.floor(quantity), effectiveStock);
  const capped = cappedQty < quantity;

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: cappedQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId, quantity: cappedQty },
    });
  }

  revalidatePath("/panier");
  await fireAbandonedCartTrigger(userId);
  return { success: true as const, quantity: cappedQty, capped };
}

// ─────────────────────────────────────────────
// Nombre total d'articles (pour badge Navbar)
// ─────────────────────────────────────────────

export async function getCartCount(): Promise<number> {
  const session = await getServerSession(authOptions);
  if (!session) return 0;
  // Badge silencieux : un CLIENT non-APPROVED ne voit rien plutôt que de
  // crasher. ADMIN peut avoir un panier (test tunnel commande) → on laisse
  // passer.
  if (
    session.user.role !== "ADMIN" &&
    (session.user.role !== "CLIENT" || session.user.status !== "APPROVED")
  ) {
    return 0;
  }

  const cart = await prisma.cart.findUnique({
    where: { userId: session.user.id },
    include: { items: { select: { quantity: true } } },
  });

  if (!cart) return 0;
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

// ─────────────────────────────────────────────
// Ajouter / incrémenter un article
// ─────────────────────────────────────────────

export async function addToCart(variantId: string, quantity: number = 1) {
  const userId = await requireClient();

  // Validate stock before adding + refuse silencieusement les produits qui ne
  // sont plus en ligne (statut OFFLINE/ARCHIVED/SYNCING). Sans ce garde-fou,
  // une page produit déjà ouverte dans un onglet permet de continuer à
  // commander un produit que l'admin vient d'archiver.
  const variant = await prisma.productColor.findUnique({
    where: { id: variantId },
    select: {
      stock: true,
      saleType: true,
      packQuantity: true,
      product: { select: { status: true } },
    },
  });
  if (!variant) throw new Error("Variante introuvable.");
  if (variant.product.status !== "ONLINE") {
    throw new Error("Ce produit n'est plus disponible à la vente.");
  }

  const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
    ? Math.floor(variant.stock / variant.packQuantity)
    : variant.stock;

  if (effectiveStock <= 0) throw new Error("Ce produit est en rupture de stock.");

  const cart = await getOrCreateCart(userId);

  const existing = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId } },
  });

  const newQty = (existing?.quantity ?? 0) + quantity;
  if (newQty > effectiveStock) {
    throw new Error(`Stock insuffisant. Disponible : ${effectiveStock}.`);
  }

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: newQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, variantId, quantity },
    });
  }

  revalidatePath("/panier");
  await fireAbandonedCartTrigger(userId);
}

// ─────────────────────────────────────────────
// Ajout batch (modal "Choisir mes options")
// ─────────────────────────────────────────────

/**
 * Ajoute plusieurs variantes en une seule opération. Utilisé par le modal
 * de sélection multi-variantes de la carte produit — permet à un client
 * de saisir des quantités pour plusieurs tailles/types/couleurs d'un même
 * produit puis d'envoyer tout d'un coup.
 *
 * Retour : nombre de lignes ajoutées, et éventuelles erreurs par variante
 * pour qu'on puisse remonter au user quelles lignes ont échoué sans tuer
 * les lignes qui sont passées.
 */
export async function addMultipleToCart(
  items: { variantId: string; quantity: number }[]
): Promise<{ addedCount: number; errors: { variantId: string; message: string }[] }> {
  const userId = await requireClient();
  const clean = items.filter((it) => it.quantity > 0);
  if (clean.length === 0) return { addedCount: 0, errors: [] };

  const cart = await getOrCreateCart(userId);
  const errors: { variantId: string; message: string }[] = [];
  let addedCount = 0;

  for (const it of clean) {
    try {
      const variant = await prisma.productColor.findUnique({
        where: { id: it.variantId },
        select: {
          stock: true,
          saleType: true,
          packQuantity: true,
          product: { select: { status: true } },
        },
      });
      if (!variant) throw new Error("Variante introuvable.");
      if (variant.product.status !== "ONLINE") {
        throw new Error("Ce produit n'est plus disponible.");
      }

      const effectiveStock = variant.saleType === "PACK" && variant.packQuantity
        ? Math.floor(variant.stock / variant.packQuantity)
        : variant.stock;

      if (effectiveStock <= 0) throw new Error("Rupture de stock.");

      const existing = await prisma.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId: it.variantId } },
      });
      const newQty = (existing?.quantity ?? 0) + it.quantity;
      if (newQty > effectiveStock) {
        throw new Error(`Stock insuffisant (${effectiveStock} dispo).`);
      }

      if (existing) {
        await prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: newQty },
        });
      } else {
        await prisma.cartItem.create({
          data: { cartId: cart.id, variantId: it.variantId, quantity: it.quantity },
        });
      }
      addedCount++;
    } catch (err) {
      errors.push({
        variantId: it.variantId,
        message: err instanceof Error ? err.message : "Erreur",
      });
    }
  }

  revalidatePath("/panier");
  if (addedCount > 0) await fireAbandonedCartTrigger(userId);
  return { addedCount, errors };
}

// ─────────────────────────────────────────────
// Modifier la quantité d'une ligne
// ─────────────────────────────────────────────

export async function updateCartItem(cartItemId: string, quantity: number) {
  const userId = await requireClient();

  // Vérifier que l'item appartient bien à l'utilisateur
  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, cart: { userId } },
    include: {
      variant: {
        select: {
          stock: true,
          saleType: true,
          packQuantity: true,
          product: { select: { status: true } },
        },
      },
    },
  });
  if (!item) throw new Error("Article introuvable.");

  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: cartItemId } });
    revalidatePath("/panier");
    await fireAbandonedCartTrigger(userId);
    return undefined;
  }

  const v = item.variant;
  // On laisse toujours diminuer/supprimer (`quantity <= 0` couvert plus haut),
  // mais on refuse d'augmenter une ligne si le produit n'est plus en ligne.
  if (v.product.status !== "ONLINE") {
    throw new Error("Ce produit n'est plus disponible à la vente.");
  }
  const effectiveStock = v.saleType === "PACK" && v.packQuantity
    ? Math.floor(v.stock / v.packQuantity)
    : v.stock;
  if (effectiveStock <= 0) {
    throw new Error("Ce produit est en rupture de stock.");
  }
  const finalQuantity = Math.min(quantity, effectiveStock);
  await prisma.cartItem.update({
    where: { id: cartItemId },
    data: { quantity: finalQuantity },
  });

  revalidatePath("/panier");
  await fireAbandonedCartTrigger(userId);
  return { quantity: finalQuantity, capped: finalQuantity < quantity };
}

// ─────────────────────────────────────────────
// Supprimer une ligne du panier
// ─────────────────────────────────────────────

export async function removeFromCart(cartItemId: string) {
  const userId = await requireClient();

  const item = await prisma.cartItem.findFirst({
    where: { id: cartItemId, cart: { userId } },
  });
  if (!item) throw new Error("Article introuvable.");

  await prisma.cartItem.delete({ where: { id: cartItemId } });
  revalidatePath("/panier");
  await fireAbandonedCartTrigger(userId);
}

// ─────────────────────────────────────────────
// Vider le panier
// ─────────────────────────────────────────────

export async function clearCart() {
  const userId = await requireClient();

  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) return;

  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  revalidatePath("/panier");
  // Panier vide → trigger annule le job pending (CART_EMPTY).
  await fireAbandonedCartTrigger(userId);
}

// ─────────────────────────────────────────────
// Adresses de livraison
// ─────────────────────────────────────────────

export async function getShippingAddresses() {
  const userId = await requireClient();
  return prisma.shippingAddress.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function saveShippingAddress(data: {
  id?: string;
  label: string;
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  zipCode: string;
  city: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}) {
  const userId = await requireClient();

  // Garde-fou dur : refuse toute adresse avec un champ obligatoire vide.
  // Sans ça, Easy-Express / Smarty365 rejettent le bordereau côté admin avec
  // « please fill in the 'City' field again » (cas Slovaquie 27BVT7AF, 2026-09).
  const missing = findMissingAddressFields(data);
  if (missing.length > 0) {
    throw new Error(serializeMissingFields(missing));
  }

  // Normalisation : trim de tous les champs pour éviter les " Paris  " parasites
  // qui posent problème aux API transporteurs.
  const normalized = {
    label:     data.label.trim(),
    firstName: data.firstName.trim(),
    lastName:  data.lastName.trim(),
    company:   data.company?.trim() || null,
    address1:  data.address1.trim(),
    address2:  data.address2?.trim() || null,
    zipCode:   data.zipCode.trim(),
    city:      data.city.trim(),
    country:   data.country.trim(),
    phone:     data.phone?.trim() || null,
    isDefault: data.isDefault ?? false,
  };

  // Si marquée comme défaut, retirer le défaut des autres
  if (normalized.isDefault) {
    await prisma.shippingAddress.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
  }

  if (data.id) {
    // Mise à jour
    const addr = await prisma.shippingAddress.findFirst({
      where: { id: data.id, userId },
    });
    if (!addr) throw new Error("Adresse introuvable.");

    return prisma.shippingAddress.update({
      where: { id: data.id },
      data: normalized,
    });
  }

  // Création
  return prisma.shippingAddress.create({
    data: {
      userId,
      ...normalized,
    },
  });
}

export async function deleteShippingAddress(addressId: string) {
  const userId = await requireClient();
  const addr = await prisma.shippingAddress.findFirst({
    where: { id: addressId, userId },
  });
  if (!addr) throw new Error("Adresse introuvable.");
  await prisma.shippingAddress.delete({ where: { id: addressId } });
}
