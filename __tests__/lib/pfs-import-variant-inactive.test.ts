import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Régression : une variante marquée `is_active: false` côté PFS était
 * importée comme active côté boutique (le champ n'était jamais lu), donc des
 * variantes retirées de la vente réapparaissaient en ligne à l'import.
 * Le fix propage `is_active` dans `ResolvedVariant.isActive`, puis le mappe
 * sur `ProductColor.disabled = !isActive` à la création.
 */

const { mockColorFindFirst } = vi.hoisted(() => ({
  mockColorFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    color: { findFirst: mockColorFindFirst, update: vi.fn() },
    size: { findFirst: vi.fn().mockResolvedValue({ id: "SIZE-TU" }) },
  },
}));

vi.mock("@/lib/pfs-import-events", () => ({
  emitImportEvent: vi.fn(),
}));

import { resolveVariant } from "@/lib/pfs-import";
import type { PfsVariantItem } from "@/lib/pfs-api";

const baseColor = {
  id: 0,
  reference: "KAKI",
  value: "#595F34",
  image: null,
  labels: { fr: "Kaki", en: "Khaki" },
};

const buildVariant = (overrides: Partial<PfsVariantItem> = {}): PfsVariantItem => ({
  id: "var_1",
  sku_suffix: null,
  type: "ITEM",
  custom_suffix: "",
  pieces: 1,
  price_sale: { unit: { value: 10, currency: "EUR" }, total: { value: 10, currency: "EUR" } },
  price_before_discount: {
    unit: { value: 10, currency: "EUR" },
    total: { value: 10, currency: "EUR" },
  },
  discount: null,
  item: { color: baseColor, size: "TU" },
  is_active: true,
  is_star: false,
  in_stock: true,
  stock_qty: 5,
  weight: 0.12,
  creation_date: null,
  ...overrides,
});

beforeEach(() => {
  mockColorFindFirst.mockReset();
  mockColorFindFirst.mockResolvedValue({ id: "LOCAL-KAKI", hex: "#595F34" });
});

describe("resolveVariant — propagation de is_active", () => {
  it("propage is_active: false → isActive: false", async () => {
    const warnings: string[] = [];
    const rv = await resolveVariant(buildVariant({ is_active: false }), warnings);
    expect(rv?.isActive).toBe(false);
  });

  it("propage is_active: true → isActive: true", async () => {
    const warnings: string[] = [];
    const rv = await resolveVariant(buildVariant({ is_active: true }), warnings);
    expect(rv?.isActive).toBe(true);
  });

  it("fallback isActive: true si is_active est undefined (compat legacy)", async () => {
    const warnings: string[] = [];
    const raw = buildVariant();
    // Force le cas legacy (payload PFS sans le champ).
    delete (raw as { is_active?: boolean }).is_active;
    const rv = await resolveVariant(raw, warnings);
    expect(rv?.isActive).toBe(true);
  });
});
