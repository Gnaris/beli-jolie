/**
 * Types partagés du module ankorstore-bo.
 *
 * Ce module talk au back-office Ankorstore (https://fr.ankorstore.com/api/…),
 * PAS à l'API partenaire OAuth2. Reverse engineering documenté dans les HARs
 * de reference (Beli & Jolie brand admin session, aoùt 2026).
 */

export interface BoSession {
  /** Cookie jar sérialisé pour renvoi au serveur ("k=v; k2=v2"). */
  cookieHeader: string;
  /** Token CSRF à injecter sur toutes les mutations (X-Aks-Csrf + X-Csrf-Token). */
  csrfToken: string;
  /** Device ID persistant par tenant, format `rjs-<uuid>`. */
  deviceId: string;
  /** ID interne Ankorstore de la marque (ex: 51370 pour Beli & Jolie). */
  brandId: number;
  /** UUID de la marque (référentiel Ankor). */
  brandUuid: string;
  /** Timestamp expiration approximative (30 min après login). */
  expiresAt: number;
  /** Tenant BJ propriétaire de la session (pour cache par tenant). */
  tenantId: string;
}

export interface BoUploadResult {
  /** `file-upload:<hash>.<ext>` — à passer en `filename` dans les payloads produit. */
  key: string;
  /** URL publique GCS de l'image (utile pour preview immédiat). */
  url: string;
  /** Nom original du fichier envoyé. */
  originalName: string;
}

export interface BoProductImage {
  /** Soit `file-upload:<hash>.jpg` (nouveau), soit `/products/images/{pid}-{hash}.jpg` (existant). */
  filename: string;
  order: number;
}

export interface BoVariantOption {
  /** 1 = size, 2 = color, 3 = other. */
  id: 1 | 2 | 3;
  name: "size" | "color" | "other";
  value: string;
}

export interface BoVariantStock {
  stock_quantity: number;
  is_always_in_stock: boolean;
  /** "continue" = accepte commandes en rupture, "deny" = refuse. */
  inventory_policy: "continue" | "deny";
}

export interface BoVariantPrice {
  currency: "EUR" | string;
  original_wholesale_price: { amount: number };
  retail_price: { amount: number };
  discount_rate: number;
}

export interface BoVariantShapeProperties {
  capacity: number | null;
  capacity_unit: string | null;
  height: number | null;
  length: number | null;
  width: number | null;
  dimensions_unit: string | null;
  weight: number | null;
  weight_unit: string | null;
}

export interface BoVariantPayload {
  /** ID interne Ankor si variante existante (pour update). Omettre pour création. */
  id?: number;
  /** SKU unique GLOBALEMENT chez Ankorstore — préfixer `BJ-` obligatoire pour éviter collisions. */
  sku: string;
  /** EAN13 optionnel. */
  ian: string | null;
  images: BoProductImage[];
  stock: BoVariantStock;
  shape_properties: BoVariantShapeProperties;
  options: BoVariantOption[];
  price: BoVariantPrice;
}

export interface BoOptionPayload {
  /** Même id que dans les variants (1=size, 2=color, 3=other). */
  id: 1 | 2 | 3;
  name: "size" | "color" | "other";
  displayName: "Size" | "Color" | "Other";
  /** Liste des valeurs déclarées (ex: ["Doré", "Argent"]). */
  values: string[];
}

export interface BoProductPayload {
  name: string;
  hs_code: string;
  original_description: string;
  brand_id: number;
  unit_multiplier: number;
  vat_rate: number;
  discount_rate: number;
  /** Prix de vente conseillé, en centimes. */
  retail_price: number;
  /** Prix de gros unitaire, en centimes. */
  original_wholesale_price: number;
  images: BoProductImage[];
  options: BoOptionPayload[];
  /** Catégories Ankor — laisser vide, Ankor devine par nom/description (auto-classification). */
  categories: number[];
  /** IDs de tags (BESTSELLER = 8). Cf. lib/ankorstore-bo/referentials.ts. */
  tags: number[];
  product_type_id: number | null;
  attributes: unknown[];
  variants: BoVariantPayload[];
  /** ID pays (ex: 46 = Chine, 76 = France). Cf. referentials.ts. */
  made_in_country_id: number;
  storage_temperature: string | null;
  needs_fresh_input: boolean;
  /** Texte libre "LxlxH" en cm. */
  dimensions: string;
  /** Texte libre "50% Coton 50% Polyester". */
  fashion_composition: string;
}

/** Résumé d'un produit tel que renvoyé par Ankor (structure allégée pour BJ). */
export interface BoProductSummary {
  id: number;
  uuid: string;
  name: string;
  link: string;
  active: boolean;
  retail_price: { amount: number; currency: string };
  wholesale_price: { amount: number; currency: string };
  original_wholesale_price: { amount: number; currency: string };
  hs_code: string;
  made_in: { id: number; iso_code: string; name: string };
  categories: Array<{ id: number; name: string }>;
  tags: string[];
  images: string[];
  requires_category_update: boolean;
  errors_count: number | null;
  validation_errors: Record<string, string[]> | null;
  has_pending_draft: boolean;
  is_new: boolean;
  vat_rate: number;
  options: Array<{ id: number; sku: string; unit_multiplier: number }>;
  variants: BoVariantSummary[];
}

export interface BoVariantSummary {
  id: number;
  uuid: string;
  sku: string;
  ian: string | null;
  images: string[] | null;
  name: string;
  options: Array<{ id: number; name: string; value: string; display_name: string }>;
  price: {
    currency: string;
    retail_price: { amount: number };
    wholesale_price: { amount: number };
    original_wholesale_price: { amount: number };
    discount_rate: number;
  };
  stock: {
    id: number;
    is_always_in_stock: boolean;
    inventory_policy: "continue" | "deny";
    available_quantity: number;
    stock_quantity: number;
    reserved_quantity: number;
    status: "in_stock" | "out_of_stock";
  };
}

export type BoMassAction = "enable" | "disable" | "archive";

export interface BoValidationError {
  message: string;
  errors: Record<string, string[]>;
}
