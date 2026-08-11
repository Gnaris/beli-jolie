import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";
import {
  buildPfsVariantCreatePayload,
  effectiveColorRef,
  normalizeColorRef,
} from "@/lib/pfs-verify-variant-ops";

// ─── Tests purs (aucun mock DB / réseau) ───────────────────────────────────

describe("pfs-verify-variant-ops — helpers purs", () => {
  it("normalizeColorRef enlève espaces + accents + met en majuscules", () => {
    expect(normalizeColorRef("Doré Rose")).toBe("DORE ROSE".replace(/\s+/g, ""));
    expect(normalizeColorRef("  Rose ")).toBe("ROSE");
    expect(normalizeColorRef("noir")).toBe("NOIR");
  });

  it("effectiveColorRef privilégie l'override puis pfsColorRef puis le map", () => {
    const map = new Map<string, string>([["Doré", "GOLDEN"]]);
    expect(
      effectiveColorRef(
        { pfsColorRefOverride: "CUSTOM", color: { name: "Doré", pfsColorRef: "GOLDEN" } },
        map,
      ),
    ).toBe("CUSTOM");
    expect(
      effectiveColorRef(
        { pfsColorRefOverride: null, color: { name: "Doré", pfsColorRef: "GOLDEN" } },
        map,
      ),
    ).toBe("GOLDEN");
    expect(
      effectiveColorRef(
        { pfsColorRefOverride: null, color: { name: "Doré", pfsColorRef: null } },
        map,
      ),
    ).toBe("GOLDEN");
    expect(
      effectiveColorRef(
        { pfsColorRefOverride: null, color: { name: "Bleu", pfsColorRef: null } },
        map,
      ),
    ).toBe("Bleu"); // fallback si non mappé
  });
});

describe("buildPfsVariantCreatePayload — UNIT", () => {
  it("bâtit une variante ITEM standard sans markup", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 12,
        weight: 0.02,
        stock: 5,
        saleType: "UNIT",
        packQuantity: null,
        disabled: false,
        colorId: "c1",
        color: { name: "Rose", hex: "#f00", pfsColorRef: "ROSE" },
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 }],
        packLines: [],
      },
      new Map(),
      undefined, // pas de markup
    );
    expect(payload).toEqual({
      type: "ITEM",
      color: "ROSE",
      size: "TU",
      price_eur_ex_vat: 12,
      weight: 0.02,
      stock_qty: 5,
      is_active: true,
    });
  });

  it("stock=0 mais disabled=false → reste is_active=true (variante en rupture visible sur PFS)", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 12,
        weight: 0.02,
        stock: 0,
        saleType: "UNIT",
        packQuantity: null,
        disabled: false,
        colorId: "c1",
        color: { name: "Rose", hex: null, pfsColorRef: "ROSE" },
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: null }, quantity: 1 }],
        packLines: [],
      },
      new Map(),
      undefined,
    );
    expect(payload?.is_active).toBe(true);
    expect(payload?.stock_qty).toBe(0);
  });

  it("disabled=true → is_active=false quel que soit le stock", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 12,
        weight: 0.02,
        stock: 10,
        saleType: "UNIT",
        packQuantity: null,
        disabled: true,
        colorId: "c1",
        color: { name: "Rose", hex: null, pfsColorRef: "ROSE" },
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: null }, quantity: 1 }],
        packLines: [],
      },
      new Map(),
      undefined,
    );
    expect(payload?.is_active).toBe(false);
  });

  it("applique le markup marketplace sur le prix", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 10,
        weight: 0.01,
        stock: 5,
        saleType: "UNIT",
        packQuantity: null,
        disabled: false,
        colorId: "c1",
        color: { name: "Rose", hex: null, pfsColorRef: "ROSE" },
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 }],
        packLines: [],
      },
      new Map(),
      { type: "percent", value: 20, rounding: "none" },
    );
    // 10 + 20% = 12
    expect(payload?.price_eur_ex_vat).toBeCloseTo(12, 2);
  });

  it("renvoie null si la couleur n'est pas résolvable (aucune source)", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 12,
        weight: 0.02,
        stock: 5,
        saleType: "UNIT",
        packQuantity: null,
        disabled: false,
        colorId: null,
        color: null,
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 }],
        packLines: [],
      },
      new Map(),
      undefined,
    );
    expect(payload).toBeNull();
  });
});

describe("buildPfsVariantCreatePayload — PACK", () => {
  it("PACK mono-couleur : divise le prix total par packQuantity", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 30, // total du pack de 3
        weight: 0.06,
        stock: 4,
        saleType: "PACK",
        packQuantity: 3,
        disabled: false,
        colorId: "c1",
        color: { name: "Doré", hex: null, pfsColorRef: "GOLDEN" },
        pfsColorRefOverride: null,
        variantSizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 3 }],
        packLines: [],
      },
      new Map(),
      undefined,
    );
    expect(payload?.type).toBe("PACK");
    expect(payload?.color).toBe("GOLDEN");
    // 30 / 3 = 10 par unité
    expect(payload?.price_eur_ex_vat).toBeCloseTo(10, 2);
    expect(payload?.packs).toEqual([{ color: "GOLDEN", size: "TU", qty: 3 }]);
  });

  it("PACK multi-couleurs : chaque ligne devient un entry pack", () => {
    const payload = buildPfsVariantCreatePayload(
      {
        unitPrice: 24, // total pack de 3 (2 rouges + 1 bleu)
        weight: 0.05,
        stock: 2,
        saleType: "PACK",
        packQuantity: 3,
        disabled: false,
        colorId: null,
        color: null,
        pfsColorRefOverride: null,
        variantSizes: [],
        packLines: [
          {
            color: { name: "Rouge", pfsColorRef: "RED" },
            position: 0,
            pfsColorRefOverride: null,
            sizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 2 }],
          },
          {
            color: { name: "Bleu", pfsColorRef: "BLUE" },
            position: 1,
            pfsColorRefOverride: null,
            sizes: [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 }],
          },
        ],
      },
      new Map(),
      undefined,
    );
    expect(payload?.type).toBe("PACK");
    // Prix pack unitaire = 24 / 3 = 8
    expect(payload?.price_eur_ex_vat).toBeCloseTo(8, 2);
    expect(payload?.color).toBe("RED"); // 1re couleur = principale
    expect(payload?.packs).toEqual([
      { color: "RED", size: "TU", qty: 2 },
      { color: "BLUE", size: "TU", qty: 1 },
    ]);
  });
});

// Note : les helpers de libellés « actionShortLabel » ont été retirés le
// 2026-07-24 avec le passage du vérificateur en mode pull-only (plus de flèche
// bascule). La modale n'affiche plus qu'une seule action « Prendre depuis PFS ».
