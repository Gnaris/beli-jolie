import { akFetch } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ── Types ──

export interface AkProduct {
  id: string;
  name: string;
  description: string;
  productTypeId: number;
  wholesalePrice: number; // centimes
  retailPrice: number; // centimes
  active: boolean;
  archived: boolean;
  outOfStock: boolean;
  images: { order: number; url: string }[];
  tags: string[];
  variantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AkVariant {
  id: string;
  name: string;
  sku: string;
  wholesalePrice: number; // centimes
  retailPrice: number; // centimes
  isAlwaysInStock: boolean;
  stockQuantity: number | null;
  availableQuantity: number | null;
  images: { order: number; url: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface AkListResponse {
  products: AkProduct[];
  variants: AkVariant[];
  nextCursor: string | null;
}

// ── Helpers ──

function parseProduct(raw: Record<string, unknown>): AkProduct {
  const attrs = raw.attributes as Record<string, unknown>;
  const rels = raw.relationships as Record<string, { data: { id: string }[] }>;
  return {
    id: raw.id as string,
    name: attrs.name as string,
    description: (attrs.description as string) || "",
    productTypeId: attrs.productTypeId as number,
    wholesalePrice: attrs.wholesalePrice as number,
    retailPrice: attrs.retailPrice as number,
    active: attrs.active as boolean,
    archived: attrs.archived as boolean,
    outOfStock: attrs.outOfStock as boolean,
    images: (attrs.images as { order: number; url: string }[]) || [],
    tags: (attrs.tags as string[]) || [],
    variantIds: (rels?.productVariants?.data || []).map((v) => v.id),
    createdAt: attrs.createdAt as string,
    updatedAt: attrs.updatedAt as string,
  };
}

function parseVariant(raw: Record<string, unknown>): AkVariant {
  const attrs = raw.attributes as Record<string, unknown>;
  return {
    id: raw.id as string,
    name: attrs.name as string,
    sku: attrs.sku as string,
    wholesalePrice: attrs.wholesalePrice as number,
    retailPrice: attrs.retailPrice as number,
    isAlwaysInStock: attrs.isAlwaysInStock as boolean,
    stockQuantity: attrs.stockQuantity as number | null,
    availableQuantity: attrs.availableQuantity as number | null,
    images: (attrs.images as { order: number; url: string }[]) || [],
    createdAt: attrs.createdAt as string,
    updatedAt: attrs.updatedAt as string,
  };
}

// ── API Functions ──

const PAGE_SIZE = 50; // max allowed by Ankorstore

export async function akListProducts(cursor?: string): Promise<AkListResponse> {
  let url = `/products?include=productVariants&page%5Blimit%5D=${PAGE_SIZE}`;
  if (cursor) {
    url += `&page%5Bafter%5D=${encodeURIComponent(cursor)}`;
  }

  const res = await akFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`akListProducts failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const products = ((json.data || []) as Record<string, unknown>[]).map(parseProduct);
  const variants = ((json.included || []) as Record<string, unknown>[])
    .filter((r) => (r.type as string) === "productVariants")
    .map(parseVariant);

  const hasMore = json.meta?.page?.hasMore === true;
  const nextCursor = hasMore ? (json.meta?.page?.to as string) : null;

  return { products, variants, nextCursor };
}

export async function akGetProduct(id: string): Promise<{ product: AkProduct; variants: AkVariant[] }> {
  const res = await akFetch(`/products/${id}?include=productVariants`);
  if (!res.ok) {
    throw new Error(`akGetProduct failed (${res.status})`);
  }

  const json = await res.json();
  const product = parseProduct(json.data);
  const variants = ((json.included || []) as Record<string, unknown>[])
    .filter((r) => (r.type as string) === "productVariants")
    .map(parseVariant);

  return { product, variants };
}

export async function akGetVariant(id: string): Promise<AkVariant> {
  const res = await akFetch(`/product-variants/${id}`);
  if (!res.ok) {
    throw new Error(`akGetVariant failed (${res.status})`);
  }

  const json = await res.json();
  return parseVariant(json.data);
}

export async function akCountProducts(): Promise<{ count: number; hasMore: boolean }> {
  const res = await akFetch(`/products?page%5Blimit%5D=${PAGE_SIZE}`);
  if (!res.ok) return { count: 0, hasMore: false };

  const json = await res.json();
  const count = ((json.data || []) as unknown[]).length;
  const hasMore = json.meta?.page?.hasMore === true;
  return { count, hasMore };
}

// ── SKU Helpers ──

export function extractReferenceFromSku(sku: string): string {
  const idx = sku.indexOf("_");
  return idx > 0 ? sku.substring(0, idx).trim() : sku.trim();
}

export function extractColorFromSku(sku: string): string {
  const idx = sku.indexOf("_");
  return idx > 0 ? sku.substring(idx + 1).trim() : "";
}

export function akPriceToBj(centimes: number): number {
  return centimes / 100;
}

export function bjPriceToAk(euros: number): number {
  return Math.round(euros * 100);
}
