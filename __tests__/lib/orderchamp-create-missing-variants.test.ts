/**
 * Orderchamp — création des variantes manquantes lors d'un update normal.
 *
 * Régression : l'update sautait silencieusement toute couleur BJ ajoutée
 * APRÈS la 1re publication OC (`orderchampVariantId` NULL). Résultat côté
 * OC : les nouvelles couleurs n'existaient pas alors que la synchro se
 * déclarait « OK ». Incident W121 (2026-09-25) : 3 couleurs Rouge / Vert
 * Clair / Bleu Ciel ajoutées, poussées sur PFS + Ankor mais absentes d'OC
 * après deux updates.
 *
 * Le fix appelle `productVariantCreate` dans l'update NORMAL — jamais dans
 * un refresh, qui via `productRepublish` bump la date OC et casse les
 * réassorts côté acheteuses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  identifyMissingOrderchampVariants,
  buildMissingVariantExpansions,
  buildOrderchampVariantCreateInput,
  type OrderchampMissingVariantInput,
} from "@/lib/orderchamp-create-missing-variants";

// ─── identifyMissingOrderchampVariants (fonction pure) ─────────────────────

describe("identifyMissingOrderchampVariants", () => {
  it("retourne les variantes UNIT sans orderchampVariantId", () => {
    const variants = [
      { id: "v1", orderchampVariantId: null, saleType: "UNIT" as const },
      { id: "v2", orderchampVariantId: "oc-42", saleType: "UNIT" as const },
      { id: "v3", orderchampVariantId: null, saleType: "UNIT" as const },
    ];
    const missing = identifyMissingOrderchampVariants(variants);
    expect(missing.map((v) => v.id)).toEqual(["v1", "v3"]);
  });

  it("exclut les variantes PACK même sans orderchampVariantId", () => {
    const variants = [
      { id: "v1", orderchampVariantId: null, saleType: "UNIT" as const },
      { id: "v2", orderchampVariantId: null, saleType: "PACK" as const },
    ];
    const missing = identifyMissingOrderchampVariants(variants);
    expect(missing.map((v) => v.id)).toEqual(["v1"]);
  });

  it("renvoie tableau vide quand toutes les variantes sont déjà liées", () => {
    const variants = [
      { id: "v1", orderchampVariantId: "oc-1", saleType: "UNIT" as const },
      { id: "v2", orderchampVariantId: "oc-2", saleType: "UNIT" as const },
    ];
    expect(identifyMissingOrderchampVariants(variants)).toEqual([]);
  });
});

// ─── buildMissingVariantExpansions (fonction pure) ─────────────────────────

const baseInput = (
  overrides: Partial<OrderchampMissingVariantInput>,
): OrderchampMissingVariantInput => ({
  id: "v1",
  orderchampVariantId: null,
  orderchampColorNameOverride: null,
  saleType: "UNIT",
  packQuantity: null,
  unitPrice: 5,
  weight: 0.025,
  stock: 300,
  disabled: false,
  color: { id: "c-rouge", name: "Rouge" },
  variantSizes: [],
  ...overrides,
});

const pricing = {
  wholesale: { type: "percent" as const, value: 0, rounding: "none" as const },
  retail: { type: "multiplier" as const, value: 3, rounding: "none" as const },
};

describe("buildMissingVariantExpansions", () => {
  it("mono-taille sans variantSizes → 1 item avec 'One Size'", () => {
    const out = buildMissingVariantExpansions([baseInput({})], "W121", pricing);
    expect(out).toHaveLength(1);
    expect(out[0]?.sizeName).toBe("One Size");
    expect(out[0]?.colorName).toBe("Rouge");
    expect(out[0]?.stock).toBe(300);
    // SKU mono-taille = base (sans suffixe). buildOrderchampVariantSkus
    // normalise couleur → majuscule + underscores.
    expect(out[0]?.sku.toLowerCase()).toContain("w121");
    expect(out[0]?.sku.toLowerCase()).toContain("rouge");
  });

  it("désactivée → stock forcé à 0", () => {
    const out = buildMissingVariantExpansions(
      [baseInput({ disabled: true, stock: 300 })],
      "W121",
      pricing,
    );
    expect(out[0]?.stock).toBe(0);
  });

  it("multi-taille → N items avec stock distribué proportionnellement", () => {
    const out = buildMissingVariantExpansions(
      [
        baseInput({
          stock: 100,
          variantSizes: [
            { size: { name: "S" }, quantity: 3 },
            { size: { name: "M" }, quantity: 7 },
          ],
        }),
      ],
      "W121",
      pricing,
    );
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.sizeName)).toEqual(["S", "M"]);
    // Stock 100 distribué 3/10 vs 7/10.
    expect(out[0]?.stock).toBe(30);
    expect(out[1]?.stock).toBe(70);
    // Chaque SKU multi-taille se termine par la taille.
    expect(out[0]?.sku.endsWith("-s")).toBe(true);
    expect(out[1]?.sku.endsWith("-m")).toBe(true);
  });

  it("override couleur écrase le nom BJ", () => {
    const out = buildMissingVariantExpansions(
      [baseInput({ orderchampColorNameOverride: "Cherry Red" })],
      "W121",
      pricing,
    );
    expect(out[0]?.colorName).toBe("Cherry Red");
  });

  it("appelle le pricing et remonte les prix wholesale/retail", () => {
    // Retail = wholesale * 3 (multiplier config), wholesale = unitPrice
    // (percent 0). Sur unitPrice 5, wholesale 5, retail 15.
    const out = buildMissingVariantExpansions([baseInput({ unitPrice: 5 })], "W121", pricing);
    expect(out[0]?.priceEur).toBeCloseTo(5, 5);
    expect(out[0]?.msrpEur).toBeCloseTo(15, 5);
  });

  it("plusieurs couleurs manquantes → une expansion par couleur", () => {
    const out = buildMissingVariantExpansions(
      [
        baseInput({ id: "v-rouge", color: { id: "c1", name: "Rouge" } }),
        baseInput({ id: "v-vert", color: { id: "c2", name: "Vert" } }),
        baseInput({ id: "v-bleu", color: { id: "c3", name: "Bleu" } }),
      ],
      "W121",
      pricing,
    );
    expect(out.map((e) => e.colorName)).toEqual(["Rouge", "Vert", "Bleu"]);
    expect(out.map((e) => e.bjVariantId)).toEqual([
      "v-rouge",
      "v-vert",
      "v-bleu",
    ]);
  });
});

// ─── buildOrderchampVariantCreateInput (fonction pure) ─────────────────────

describe("buildOrderchampVariantCreateInput", () => {
  const expansion = {
    bjVariantId: "v1",
    colorId: "c1",
    colorName: "Rouge",
    sizeName: "One Size",
    sku: "W121_ROUGE",
    priceEur: 5,
    msrpEur: 15,
    weightGrams: 25,
    stock: 300,
  };

  it("payload contient productId + les champs OC requis", () => {
    const input = buildOrderchampVariantCreateInput(
      expansion,
      "gid://orderchamp/Product/42",
      { lengthCm: 6, widthCm: 6, heightCm: 0.3 },
      "7117.19",
    );
    expect(input.productId).toBe("gid://orderchamp/Product/42");
    expect(input.sku).toBe("W121_ROUGE");
    expect(input.price).toBe(5);
    expect(input.msrp).toBe(15);
    expect(input.inventoryQuantity).toBe(300);
    expect(input.inventoryPolicy).toBe("DENY");
    expect(input.option1).toBe("Rouge");
    expect(input.option2).toBe("One Size");
    expect(input.weight).toBe(25);
    expect(input.length).toBe(6);
    expect(input.width).toBe(6);
    expect(input.height).toBe(0.3);
    expect(input.hsCode).toBe("7117.19");
  });

  it("omet dimensions et hsCode quand absents", () => {
    const input = buildOrderchampVariantCreateInput(
      expansion,
      "gid://orderchamp/Product/42",
      {},
      null,
    );
    expect(input.length).toBeUndefined();
    expect(input.width).toBeUndefined();
    expect(input.height).toBeUndefined();
    expect(input.diameter).toBeUndefined();
    expect(input.hsCode).toBeUndefined();
  });
});

// ─── orderchampCreateMissingVariants (I/O — mocké) ─────────────────────────

const {
  orderchampGraphQLSpy,
  productColorUpdateSpy,
} = vi.hoisted(() => ({
  orderchampGraphQLSpy: vi.fn(),
  productColorUpdateSpy: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    productColor: {
      update: (...a: unknown[]) => productColorUpdateSpy(...a),
    },
  },
}));
vi.mock("@/lib/orderchamp-client", () => ({
  orderchampGraphQL: orderchampGraphQLSpy,
  extractUserErrors: (payload: { userErrors: Array<Record<string, unknown>> }) =>
    payload?.userErrors ?? [],
  formatUserErrors: (errs: Array<{ message?: string }>) =>
    errs && errs.length > 0 ? errs.map((e) => e.message).join(" · ") : null,
}));
vi.mock("@/lib/orderchamp-queries", () => ({
  PRODUCT_VARIANT_CREATE_MUTATION: "mutation ProductVariantCreate",
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { orderchampCreateMissingVariants } from "@/lib/orderchamp-create-missing-variants";

describe("orderchampCreateMissingVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("early-return quand aucune variante manquante", async () => {
    const res = await orderchampCreateMissingVariants({
      productId: "p1",
      orderchampProductId: "oc-p1",
      reference: "W121",
      missing: [],
      pricing,
      dimensions: {},
      hsCode: null,
    });
    expect(res.createdCount).toBe(0);
    expect(orderchampGraphQLSpy).not.toHaveBeenCalled();
    expect(productColorUpdateSpy).not.toHaveBeenCalled();
  });

  it("crée 3 variantes OC, persist les 3 IDs, aucune erreur", async () => {
    orderchampGraphQLSpy
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-rouge", sku: "sku-rouge" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-vert", sku: "sku-vert" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-bleu", sku: "sku-bleu" },
          userErrors: [],
        },
      });

    const res = await orderchampCreateMissingVariants({
      productId: "p1",
      orderchampProductId: "oc-p1",
      reference: "W121",
      missing: [
        baseInput({ id: "v-rouge", color: { id: "c1", name: "Rouge" } }),
        baseInput({ id: "v-vert", color: { id: "c2", name: "Vert Clair" } }),
        baseInput({ id: "v-bleu", color: { id: "c3", name: "Bleu Ciel" } }),
      ],
      pricing,
      dimensions: { lengthCm: 6, widthCm: 6, heightCm: 0.3 },
      hsCode: "7117.19",
    });

    expect(res.createdCount).toBe(3);
    expect(orderchampGraphQLSpy).toHaveBeenCalledTimes(3);
    // Chaque appel productVariantCreate porte le bon productId + option1
    for (let i = 0; i < 3; i++) {
      const args = orderchampGraphQLSpy.mock.calls[i]!;
      expect(args[2]).toBe("productVariantCreate");
      const input = (args[1] as { input: Record<string, unknown> }).input;
      expect(input.productId).toBe("oc-p1");
      expect(input.inventoryPolicy).toBe("DENY");
      expect(input.hsCode).toBe("7117.19");
    }
    // Persistance BDD des 3 IDs
    expect(productColorUpdateSpy).toHaveBeenCalledTimes(3);
    expect(res.bjVariantIdToOrderchampVariantId.get("v-rouge")).toBe("oc-rouge");
    expect(res.bjVariantIdToOrderchampVariantId.get("v-vert")).toBe("oc-vert");
    expect(res.bjVariantIdToOrderchampVariantId.get("v-bleu")).toBe("oc-bleu");
    expect(res.warnings).toHaveLength(0);
  });

  it("multi-taille : ne persiste que le premier orderchampVariantId par bjVariantId", async () => {
    orderchampGraphQLSpy
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-rouge-S", sku: "sku-S" },
          userErrors: [],
        },
      })
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-rouge-M", sku: "sku-M" },
          userErrors: [],
        },
      });

    const res = await orderchampCreateMissingVariants({
      productId: "p1",
      orderchampProductId: "oc-p1",
      reference: "W121",
      missing: [
        baseInput({
          id: "v-rouge",
          color: { id: "c1", name: "Rouge" },
          variantSizes: [
            { size: { name: "S" }, quantity: 1 },
            { size: { name: "M" }, quantity: 1 },
          ],
        }),
      ],
      pricing,
      dimensions: {},
      hsCode: null,
    });

    // 2 appels create OC (une par taille)
    expect(orderchampGraphQLSpy).toHaveBeenCalledTimes(2);
    // Un seul update BDD (premier ID uniquement)
    expect(productColorUpdateSpy).toHaveBeenCalledTimes(1);
    expect(res.bjVariantIdToOrderchampVariantId.get("v-rouge")).toBe("oc-rouge-S");
    expect(res.createdCount).toBe(1);
  });

  it("échec sur une variante : warning ajouté, les autres continuent", async () => {
    orderchampGraphQLSpy
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: null,
          userErrors: [{ field: ["sku"], message: "SKU already taken" }],
        },
      })
      .mockResolvedValueOnce({
        productVariantCreate: {
          productVariant: { id: "oc-vert", sku: "sku-vert" },
          userErrors: [],
        },
      });

    const res = await orderchampCreateMissingVariants({
      productId: "p1",
      orderchampProductId: "oc-p1",
      reference: "W121",
      missing: [
        baseInput({ id: "v-rouge", color: { id: "c1", name: "Rouge" } }),
        baseInput({ id: "v-vert", color: { id: "c2", name: "Vert" } }),
      ],
      pricing,
      dimensions: {},
      hsCode: null,
    });

    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings[0]).toContain("Rouge");
    expect(res.warnings[0]).toContain("SKU already taken");
    // Vert bien créé et persisté
    expect(res.bjVariantIdToOrderchampVariantId.get("v-vert")).toBe("oc-vert");
    expect(res.bjVariantIdToOrderchampVariantId.has("v-rouge")).toBe(false);
    expect(res.createdCount).toBe(1);
  });

  it("exception réseau sur une variante : warning ajouté, ne jette pas", async () => {
    orderchampGraphQLSpy.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    const res = await orderchampCreateMissingVariants({
      productId: "p1",
      orderchampProductId: "oc-p1",
      reference: "W121",
      missing: [
        baseInput({ id: "v-rouge", color: { id: "c1", name: "Rouge" } }),
      ],
      pricing,
      dimensions: {},
      hsCode: null,
    });

    expect(res.createdCount).toBe(0);
    expect(res.warnings[0]).toContain("ETIMEDOUT");
    expect(productColorUpdateSpy).not.toHaveBeenCalled();
  });
});
