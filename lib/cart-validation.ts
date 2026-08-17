/**
 * lib/cart-validation.ts
 *
 * Vérifie que TOUS les articles d'un panier sont vendables MAINTENANT :
 *  - le produit est ONLINE (pas OFFLINE / ARCHIVED / SYNCING),
 *  - le stock disponible suffit à couvrir la quantité demandée
 *    (PACK : la quantité en paquets × packQuantity ≤ stock en pièces).
 *
 * Utilisé à 3 endroits pour ceinture + bretelles :
 *  - /api/cart/validate  → clic « Passer commande » sur /panier, « Suivant »
 *                          entre étapes de /panier/commande, mount de la page
 *                          /panier/commande.
 *  - /api/payments/create-intent → avant création du PaymentIntent Stripe
 *                                  (bloque tout débit CB sur article manquant).
 *  - placeOrder (server action) → transaction atomique finale.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { stockUnitsForCartLine } from "@/lib/stock-units";

export type CartValidationErrorReason =
  | "offline"           // produit passé OFFLINE / ARCHIVED / SYNCING
  | "out_of_stock"      // stock à 0
  | "insufficient_stock"; // stock > 0 mais < demandé

export interface CartValidationError {
  itemId: string;
  variantId: string;
  productName: string;
  productReference: string | null;
  reason: CartValidationErrorReason;
  /** Unité affichée à la cliente : « paquet » pour PACK > 1, sinon vide (pièces). */
  unitLabel: "" | "paquet" | "paquets";
  requested: number;
  available: number;
  /** Message prêt à l'affichage côté client (FR, non-technique). */
  message: string;
}

export interface CartValidationResult {
  ok: boolean;
  errors: CartValidationError[];
}

interface CartLineInput {
  id: string;
  quantity: number;
  variant: {
    id: string;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    stock: number;
    product: {
      name: string;
      reference: string | null;
      status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
    };
  };
}

/**
 * Version pure : accepte le panier déjà chargé et renvoie les erreurs. Ne
 * touche pas la BDD. Utilisée par create-intent et placeOrder qui ont déjà
 * lu le panier avec ses variantes.
 */
export function validateCartLines(items: CartLineInput[]): CartValidationResult {
  const errors: CartValidationError[] = [];

  for (const item of items) {
    const v = item.variant;
    const packQty = v.packQuantity ?? 1;
    const isPack = v.saleType === "PACK" && packQty > 1;

    // 1. Produit toujours en ligne ?
    if (v.product.status !== "ONLINE") {
      errors.push({
        itemId: item.id,
        variantId: v.id,
        productName: v.product.name,
        productReference: v.product.reference,
        reason: "offline",
        unitLabel: "",
        requested: item.quantity,
        available: 0,
        message: `« ${v.product.name} » n'est plus disponible à la vente.`,
      });
      continue;
    }

    // 2. Assez de stock ?
    const needed = stockUnitsForCartLine(item);
    const stock = v.stock;
    if (stock >= needed) continue;

    const availableForDisplay = isPack ? Math.floor(stock / packQty) : stock;
    const unitLabel: CartValidationError["unitLabel"] = isPack
      ? availableForDisplay > 1
        ? "paquets"
        : "paquet"
      : "";

    if (availableForDisplay <= 0) {
      errors.push({
        itemId: item.id,
        variantId: v.id,
        productName: v.product.name,
        productReference: v.product.reference,
        reason: "out_of_stock",
        unitLabel,
        requested: item.quantity,
        available: 0,
        message: `« ${v.product.name} » est en rupture de stock.`,
      });
    } else {
      const unitSuffix = unitLabel ? ` ${unitLabel}` : "";
      errors.push({
        itemId: item.id,
        variantId: v.id,
        productName: v.product.name,
        productReference: v.product.reference,
        reason: "insufficient_stock",
        unitLabel,
        requested: item.quantity,
        available: availableForDisplay,
        message: `« ${v.product.name} » : stock insuffisant (il en reste ${availableForDisplay}${unitSuffix}, vous en demandez ${item.quantity}).`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Charge le panier de l'utilisateur et applique `validateCartLines`. Utilisé
 * par la route /api/cart/validate.
 */
export async function validateCartForUser(userId: string): Promise<CartValidationResult> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              saleType: true,
              packQuantity: true,
              stock: true,
              product: {
                select: {
                  name: true,
                  reference: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return { ok: true, errors: [] };
  }

  return validateCartLines(cart.items as CartLineInput[]);
}
