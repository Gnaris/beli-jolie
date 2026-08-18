/**
 * Types partagés par les composants du wizard /panier.
 * Alignés sur les sérialisations produites par app/[locale]/(client)/panier/page.tsx.
 */

import type { ProductMeta } from "@/app/actions/client/cart";

export type WizardStep = 1 | 2 | 3;

export type DeliveryMode = "delivery" | "pickup" | "private" | "merge";

export type PrivateSubMode = "contact" | "bordereau";

export interface WizardCart {
  id: string;
  items: WizardCartItem[];
}

export interface WizardCartItem {
  id: string;
  quantity: number;
  variant: {
    id: string;
    productId: string;
    colorId: string | null;
    unitPrice: number;
    weight: number;
    stock?: number;
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
}

export interface WizardAddress {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  company: string | null;
  address1: string;
  address2: string | null;
  zipCode: string;
  city: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface WizardCarrier {
  id: string;
  name: string;
  price: number;
  delay: string;
  logoUrl?: string;
  /** Signature HMAC anti-fraude renvoyée par /api/carriers, à repasser à /api/payments/create-intent. */
  sig?: string;
}

export interface WizardBillingInfo {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string;
  vatNumber: string;
  address1: string;
  address2: string;
  zipCode: string;
  city: string;
  country: string;
}

export interface WizardUser {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  siret: string | null;
  vatNumber: string | null;
  vatExempt: boolean;
  addressStreet: string | null;
  addressComplement: string | null;
  addressZip: string | null;
  addressCity: string | null;
  addressCountry: string | null;
}

export interface WizardClientDiscount {
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  freeShipping: boolean;
  freeShippingMaxPrice: number | null;
  /** Remise commerciale sur la LIVRAISON (distincte de la remise produits). */
  shippingDiscountType: "PERCENT" | "AMOUNT" | null;
  shippingDiscountValue: number | null;
}

export interface WizardShippingPromo {
  id: string;
  name: string;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: number;
  /** Si false, la promo ne se cumule pas avec la remise commerciale client. */
  stackable: boolean;
}

export interface WizardPromoInfo {
  finalUnitPrice: number;
  savedPerUnit: number;
  displayPercent: number;
  promotionName: string | null;
  source: "none" | "product" | "promotion" | "client" | "stack";
}

export interface WizardPickupInfo {
  store: {
    name: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
    phone: string;
  };
  schedule: { day: string; hours: string }[];
}

export interface WizardMergeCandidate {
  id: string;
  orderNumber: string;
  createdAtIso: string;
  totalTTC: number;
  carrierName: string;
  carrierPrice: number;
  itemsCount: number;
  shipAddressShort: string;
}

export type WizardProductsMeta = Record<string, ProductMeta>;
