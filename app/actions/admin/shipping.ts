"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  createEasyExpressShipment,
  fetchEasyExpressRates,
  splitWeightIntoParcels,
  MAX_PARCEL_WEIGHT_KG,
} from "@/lib/easy-express";
import {
  createSmarty365Parcel,
  smarty365Rates,
  isSmarty365CarrierId,
  parseSmarty365CarrierId,
} from "@/lib/smarty365";
import { getCachedActiveShippingProvider } from "@/lib/cached-data";

/**
 * Détermine si le pays de livraison est en UE ou en France métropolitaine.
 * Utilisé pour décider s'il faut envoyer `customsItems` à Smarty365 (obligatoire
 * pour DOM-TOM RE/GP/MQ/GF/YT/NC/PF… et pour tout pays hors UE).
 */
const EU_COUNTRY_CODES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
]);
function isEuOrFrMetropolitan(countryCode: string): boolean {
  return EU_COUNTRY_CODES.has(countryCode);
}

/**
 * Vérifie qu'une commande est prête pour l'envoi douanier (DOM-TOM / hors UE) :
 * tous les OrderItems rattachés à un Product doivent avoir un code SH.
 * Les items sans productColorId (compensations admin non rattachées) sont
 * ignorés — ils tomberont sur le fallback générique côté buildCustomsItems.
 *
 * Retourne `{ ok: true }` si tout est OK, sinon `{ ok: false, missingRefs }`
 * avec la liste des références produit sans code SH (dédoublonnées).
 */
async function checkOrderCustomsReadiness(
  orderId: string,
): Promise<{ ok: true } | { ok: false; missingRefs: string[] }> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { productRef: true, productColorId: true },
  });
  const colorIds = items
    .map((i) => i.productColorId)
    .filter((id): id is string => !!id);
  if (colorIds.length === 0) return { ok: true }; // aucun item rattaché → fallback global

  const colors = await prisma.productColor.findMany({
    where: { id: { in: colorIds } },
    select: {
      id: true,
      product: { select: { reference: true, hsCodeId: true } },
    },
  });
  const missing = new Set<string>();
  for (const c of colors) {
    if (!c.product?.hsCodeId) {
      missing.add(c.product?.reference ?? "(référence inconnue)");
    }
  }
  return missing.size === 0
    ? { ok: true }
    : { ok: false, missingRefs: Array.from(missing).sort() };
}

/**
 * Construit la déclaration douanière ligne par ligne pour une commande.
 * Chaque OrderItem devient un item Smarty365 avec :
 *   - `description` = nom du produit (snapshot dans OrderItem.productName)
 *   - `hscode`     = Product.hsCode.code (fallback "71171900" — bijouterie fantaisie)
 *   - `originCountry` = Product.countryIsoCode (fallback "CN")
 *   - `quantity`   = OrderItem.quantity
 *   - `value`      = prix unitaire HT × quantité (arrondi entier supérieur)
 *   - `weight`     = poids unitaire × quantité (approximé depuis variantSnapshot)
 *
 * Si aucun item n'a de productColorId (cas rare, ex : compensation admin non
 * rattachée), fallback vers 1 item agrégé pour ne jamais échouer la douane.
 */
interface Smarty365CustomsItemDoc {
  hscode: string;
  originCountry: string;
  weight: string;
  quantity: string;
  value: string;
  description: string;
}

async function buildCustomsItemsForOrder(
  orderId: string,
  insuredValueEurFallback: number,
  weightKgFallback: number,
): Promise<Smarty365CustomsItemDoc[]> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: {
      productName: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      variantSnapshot: true,
      productColorId: true,
    },
  });

  // Résolution HS code + pays d'origine via ProductColor → Product
  const colorIds = items
    .map((i) => i.productColorId)
    .filter((id): id is string => !!id);
  const products = colorIds.length > 0
    ? await prisma.productColor.findMany({
        where: { id: { in: colorIds } },
        select: {
          id: true,
          product: {
            select: { countryIsoCode: true, hsCode: { select: { code: true } } },
          },
        },
      })
    : [];
  const productByColorId = new Map(products.map((c) => [c.id, c.product]));

  const customs: Smarty365CustomsItemDoc[] = [];
  for (const it of items) {
    const p = it.productColorId ? productByColorId.get(it.productColorId) : null;
    const hsCode = p?.hsCode?.code?.trim() || "71171900";
    const origin = p?.countryIsoCode?.trim() || "CN";

    // Poids unitaire depuis variantSnapshot (arrondi kg entier minimum 0.1)
    let unitWeightKg = 0.1;
    if (it.variantSnapshot) {
      try {
        const snap = JSON.parse(it.variantSnapshot) as {
          weight?: number; saleType?: string; packQuantity?: number;
        };
        const packMult = snap.saleType === "PACK" && snap.packQuantity ? snap.packQuantity : 1;
        unitWeightKg = Math.max(0.1, Number(snap.weight ?? 0) * packMult);
      } catch { /* fallback */ }
    }

    const lineValue = Math.max(1, Math.ceil(Number(it.lineTotal ?? Number(it.unitPrice) * it.quantity)));
    const lineWeightKg = Math.max(0.1, unitWeightKg * it.quantity);

    customs.push({
      hscode: hsCode,
      originCountry: origin,
      weight: String(lineWeightKg),
      quantity: String(it.quantity),
      value: String(lineValue),
      description: it.productName.slice(0, 100), // Smarty365 accepte long, on limite raisonnablement
    });
  }

  // Fallback ultime : commande sans aucun item exploitable
  if (customs.length === 0) {
    return [{
      hscode: "71171900",
      originCountry: "CN",
      weight: String(Math.max(0.1, weightKgFallback)),
      quantity: "1",
      value: String(Math.max(1, Math.ceil(insuredValueEurFallback))),
      description: "Bijoux fantaisie",
    }];
  }
  return customs;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

interface ShippingResult {
  success: boolean;
  error?: string;
  trackingId?: string | null;
  labelUrl?: string | null;
  /**
   * Liste des transporteurs disponibles renvoyée par le fournisseur actif, à
   * afficher à l'admin si le transporteur initialement choisi par le client
   * n'existe plus dans la nouvelle cotation. L'admin peut alors en choisir un
   * autre depuis la liste.
   */
  availableCarriers?: { id: string; name: string; price: number; delay: string }[];
  /** transactionId à renvoyer si l'admin choisit un autre transporteur (Easy-Express uniquement). */
  transactionId?: string;
}

/**
 * Calcule le poids total d'une commande à partir de ses items + variantes liées.
 * Utilisé pour la cotation Easy-Express / Smarty365 différée côté admin.
 */
async function computeOrderWeightKg(orderId: string): Promise<number> {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { quantity: true, variantSnapshot: true },
  });

  let total = 0;
  for (const item of items) {
    let weightPerUnit = 0;
    let packQty = 1;
    if (item.variantSnapshot) {
      try {
        const snap = JSON.parse(item.variantSnapshot) as {
          weight?: number;
          saleType?: string;
          packQuantity?: number;
        };
        weightPerUnit = Number(snap.weight ?? 0);
        if (snap.saleType === "PACK" && snap.packQuantity) {
          packQty = Number(snap.packQuantity);
        }
      } catch {
        // Snapshot illisible : on retombe à 0 pour cet item.
      }
    }
    total += weightPerUnit * packQty * item.quantity;
  }
  return Math.max(1, total);
}

/**
 * Détermine le fournisseur à utiliser pour cette commande :
 *   1. Si l'Order a déjà un bordereau (ee* ou smarty*), on garde le même provider.
 *   2. Sinon, si le carrierId d'origine est un ID Smarty365 (`smarty:…`), c'est Smarty365.
 *   3. Sinon on prend le fournisseur actif du tenant.
 */
async function resolveProviderForOrder(order: {
  carrierId: string | null;
  shippingProvider: string | null;
  eeLabelUrl: string | null;
  smartyLabelUrl: string | null;
}): Promise<"easy_express" | "smarty365"> {
  if (order.shippingProvider === "smarty365") return "smarty365";
  if (order.shippingProvider === "easy_express") return "easy_express";
  if (order.smartyLabelUrl) return "smarty365";
  if (order.eeLabelUrl) return "easy_express";
  if (isSmarty365CarrierId(order.carrierId)) return "smarty365";
  return await getCachedActiveShippingProvider();
}

/**
 * Génère le bordereau (Easy-Express ou Smarty365) pour une commande.
 *
 * Le fournisseur est résolu automatiquement à partir de la commande — cf.
 * `resolveProviderForOrder`. L'admin peut forcer un transporteur précis via
 * `override.carrierId` (mode picker : le client a choisi Chrono, on lui
 * substitue Colissimo par exemple).
 */
export async function generateShipmentLabel(
  orderId: string,
  override?: { carrierId: string; transactionId: string },
): Promise<ShippingResult> {
  await requireAdmin();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      carrierId: true,
      carrierName: true,
      shipFirstName: true,
      shipLastName: true,
      shipCompany: true,
      shipAddress1: true,
      shipAddress2: true,
      shipZipCode: true,
      shipCity: true,
      shipCountry: true,
      clientEmail: true,
      clientPhone: true,
      shippingProvider: true,
      eeLabelUrl: true,
      smartyLabelUrl: true,
      // Valeur des marchandises pour l'assurance Smarty365.
      subtotalHT: true,
      paidSubtotalHT: true,
    },
  });

  if (!order) return { success: false, error: "Commande introuvable." };

  const weightKg = await computeOrderWeightKg(orderId);

  // Si l'admin a explicitement choisi un transporteur override, on lit le
  // provider dans le carrierId (le picker renvoie soit un carrierId Smarty365,
  // soit un carrierId Easy-Express).
  if (override) {
    if (isSmarty365CarrierId(override.carrierId)) {
      return await runSmartyCheckout(order, weightKg, override.carrierId);
    }
    return await runEasyExpressCheckout(order, weightKg, override.transactionId, override.carrierId);
  }

  // Sinon on résout le provider depuis la commande / le réglage actif.
  const provider = await resolveProviderForOrder(order);

  if (provider === "smarty365") {
    return await runSmartyMatch(order, weightKg);
  }
  return await runEasyExpressMatch(order, weightKg);
}

// ─────────────────────────────────────────────────────
// Easy-Express — match par nom + checkout
// ─────────────────────────────────────────────────────

async function runEasyExpressMatch(
  order: OrderForCheckout,
  weightKg: number,
): Promise<ShippingResult> {
  const rates = await fetchEasyExpressRates({
    receiverCountry: order.shipCountry,
    receiverZipCode: order.shipZipCode,
    weightKg,
  });

  if (!rates.success) {
    return { success: false, error: rates.error };
  }

  if (rates.carriers.length === 0) {
    return {
      success: false,
      error: "Aucun transporteur Easy-Express ne dessert ce pays.",
    };
  }

  const targetName = order.carrierName.trim().toLowerCase();
  const match = rates.carriers.find(
    (c) => c.name.trim().toLowerCase() === targetName,
  );

  if (!match) {
    return {
      success: false,
      error:
        `Le transporteur initialement choisi (« ${order.carrierName} ») n'est plus disponible. ` +
        "Sélectionnez-en un autre dans la liste.",
      transactionId: rates.transactionId,
      availableCarriers: rates.carriers.map((c) => ({
        id: c.carrierId,
        name: c.name,
        price: c.price,
        delay: c.delay,
      })),
    };
  }

  return await runEasyExpressCheckout(order, weightKg, rates.transactionId, match.carrierId);
}

interface OrderForCheckout {
  id: string;
  orderNumber: string;
  carrierId: string | null;
  carrierName: string;
  shipFirstName: string;
  shipLastName: string;
  shipCompany: string | null;
  shipAddress1: string;
  shipAddress2: string | null;
  shipZipCode: string;
  shipCity: string;
  shipCountry: string;
  clientEmail: string;
  clientPhone: string;
  shippingProvider: string | null;
  eeLabelUrl: string | null;
  smartyLabelUrl: string | null;
  subtotalHT: unknown;         // Prisma.Decimal (converti via Number() côté smarty)
  paidSubtotalHT: unknown;     // Prisma.Decimal? — snapshot immuable
}

async function runEasyExpressCheckout(
  order: OrderForCheckout,
  weightKg: number,
  transactionId: string,
  carrierId: string,
): Promise<ShippingResult> {
  // Garde-fou : Easy-Express plafonne le poids par colis (cf. splitWeightIntoParcels).
  const parcels = splitWeightIntoParcels(weightKg);
  if (parcels.length === 0) {
    return {
      success: false,
      error: `Poids invalide pour Easy-Express (limite ${MAX_PARCEL_WEIGHT_KG} kg / colis).`,
    };
  }

  const result = await createEasyExpressShipment({
    transactionId,
    carrierId,
    orderNumber: order.orderNumber,
    weightKg,
    toFirstName: order.shipFirstName,
    toLastName: order.shipLastName,
    toCompany: order.shipCompany,
    toEmail: order.clientEmail,
    toAddress1: order.shipAddress1,
    toAddress2: order.shipAddress2,
    toZipCode: order.shipZipCode,
    toCity: order.shipCity,
    toCountry: order.shipCountry,
    toPhone: order.clientPhone,
  });

  if (!result.success) {
    logger.warn("[generateShipmentLabel] Easy-Express checkout failed", {
      orderId: order.id,
      error: result.error,
    });
    return { success: false, error: result.error };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      eeTrackingId: result.trackingId,
      eeLabelUrl: result.labelUrl,
      shippingProvider: "easy_express",
    },
  });

  revalidatePath(`/admin/commandes/${order.id}`);
  revalidatePath("/admin/commandes");

  return {
    success: true,
    trackingId: result.trackingId,
    labelUrl: result.labelUrl,
  };
}

// ─────────────────────────────────────────────────────
// Smarty365 — match par nom + création parcel
// ─────────────────────────────────────────────────────

async function runSmartyMatch(
  order: OrderForCheckout,
  weightKg: number,
): Promise<ShippingResult> {
  // Cas idéal : le carrierId est déjà un ID Smarty365 → on l'utilise direct.
  if (isSmarty365CarrierId(order.carrierId)) {
    return await runSmartyCheckout(order, weightKg, order.carrierId!);
  }

  // Sinon (commande passée quand Easy-Express était actif, ou carrierId legacy)
  // → on recote avec Smarty365 et on essaie de matcher par nom.
  const rates = await smarty365Rates({
    receiverCountry: order.shipCountry,
    receiverZipCode: order.shipZipCode,
    weightKg,
  });

  if (!rates.success) return { success: false, error: rates.error };

  if (rates.carriers.length === 0) {
    return {
      success: false,
      error: "Aucun transporteur Smarty365 ne dessert ce pays pour ce poids.",
    };
  }

  const targetName = order.carrierName.trim().toLowerCase();
  const match = rates.carriers.find((c) => c.name.trim().toLowerCase() === targetName);

  if (!match) {
    return {
      success: false,
      error:
        `Le transporteur initialement choisi (« ${order.carrierName} ») n'est pas disponible chez Smarty365. ` +
        "Sélectionnez-en un autre dans la liste.",
      // Pas de transactionId côté Smarty365 — le picker peut renvoyer le carrierId direct.
      transactionId: "",
      availableCarriers: rates.carriers.map((c) => ({
        id: c.carrierId,
        name: c.name,
        price: c.price,
        delay: c.delay,
      })),
    };
  }

  return await runSmartyCheckout(order, weightKg, match.carrierId);
}

async function runSmartyCheckout(
  order: OrderForCheckout,
  weightKg: number,
  carrierId: string,
): Promise<ShippingResult> {
  const parsed = parseSmarty365CarrierId(carrierId);
  if (!parsed) {
    return { success: false, error: "Identifiant transporteur Smarty365 invalide." };
  }

  // Valeur assurée = sous-total HT payé (immuable) ; fallback subtotalHT courant
  // pour les commandes anciennes qui n'ont pas paidSubtotalHT.
  const insuredValueEur = Number(order.paidSubtotalHT ?? order.subtotalHT ?? 0);

  // Items douaniers — obligatoires pour DOM-TOM et hors UE.
  // Pré-check dur : tous les produits rattachés doivent avoir un code SH.
  // Sans code SH sur une destination avec douane, on refuse plutôt que
  // d'envoyer une déclaration approximative qui peut faire bloquer le colis.
  const countryCode = order.shipCountry.trim().toUpperCase();
  const needsCustoms = !isEuOrFrMetropolitan(countryCode);
  let customsItems: Smarty365CustomsItemDoc[] | undefined;
  if (needsCustoms) {
    const check = await checkOrderCustomsReadiness(order.id);
    if (!check.ok) {
      return {
        success: false,
        error:
          `Bordereau bloqué — destination ${countryCode} nécessite une déclaration douanière.\n\n` +
          `Les produits suivants n'ont pas de code SH renseigné :\n` +
          check.missingRefs.map((r) => `• ${r}`).join("\n") +
          `\n\nOuvrez chaque produit dans l'admin, onglet Douane, et renseignez son code SH avant de réessayer.`,
      };
    }
    customsItems = await buildCustomsItemsForOrder(order.id, insuredValueEur, weightKg);
  }

  const result = await createSmarty365Parcel({
    transporter: parsed.transporter,
    routeCode: parsed.routeCode,
    orderNumber: order.orderNumber,
    weightKg,
    insuredValueEur,
    customsItems,
    toFirstName: order.shipFirstName,
    toLastName: order.shipLastName,
    toCompany: order.shipCompany,
    toEmail: order.clientEmail,
    toAddress1: order.shipAddress1,
    toAddress2: order.shipAddress2,
    toZipCode: order.shipZipCode,
    toCity: order.shipCity,
    toCountry: order.shipCountry,
    toPhone: order.clientPhone,
  });

  if (!result.success) {
    logger.warn("[generateShipmentLabel] Smarty365 parcel failed", {
      orderId: order.id,
      error: result.error,
    });
    return { success: false, error: result.error };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      smartyParcelId: result.parcelId,
      smartyTrackingId: result.trackingId,
      smartyLabelUrl: result.labelUrl,
      smartyTransporter: result.transporter,
      smartyRouteCode: result.routeCode,
      shippingProvider: "smarty365",
    },
  });

  revalidatePath(`/admin/commandes/${order.id}`);
  revalidatePath("/admin/commandes");

  return {
    success: true,
    trackingId: result.trackingId,
    labelUrl: result.labelUrl,
  };
}

/**
 * Saisie manuelle du suivi : utilisé quand l'admin a généré le bordereau
 * en dehors de notre système (portail Easy-Express direct, Smarty365 direct,
 * autre service…) et veut juste enregistrer le numéro de suivi + le nom du
 * transporteur.
 *
 * Met les URLs de bordereau à null parce qu'on n'a pas de PDF récupérable.
 */
export async function setManualShipping(
  orderId: string,
  input: { carrierName: string; trackingId: string },
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const carrierName = input.carrierName.trim();
  const trackingId = input.trackingId.trim();

  if (!carrierName) return { success: false, error: "Nom du transporteur requis." };
  if (!trackingId) return { success: false, error: "Numéro de suivi requis." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) return { success: false, error: "Commande introuvable." };

  await prisma.order.update({
    where: { id: orderId },
    data: {
      carrierName,
      eeTrackingId: trackingId,
      eeLabelUrl: null,
      smartyTrackingId: null,
      smartyLabelUrl: null,
      smartyParcelId: null,
      shippingProvider: null,
    },
  });

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");

  return { success: true };
}

/**
 * Réinitialise le suivi (retire numéro et URL du bordereau).
 * Sert quand l'admin s'est trompé et veut recommencer.
 */
export async function clearShipping(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) return { success: false, error: "Commande introuvable." };

  await prisma.order.update({
    where: { id: orderId },
    data: {
      eeTrackingId: null,
      eeLabelUrl: null,
      smartyTrackingId: null,
      smartyLabelUrl: null,
      smartyParcelId: null,
      smartyTransporter: null,
      smartyRouteCode: null,
      shippingProvider: null,
    },
  });

  revalidatePath(`/admin/commandes/${orderId}`);
  revalidatePath("/admin/commandes");

  return { success: true };
}
