import { describe, it, expect } from "vitest";
import { buildPatchBody } from "@/lib/faire-update";
import type { FaireSyncDiff } from "@/lib/faire-sync-diff";

const emptyDiff: FaireSyncDiff = {
  productChanged: false,
  productImagesChanged: false,
  variantsChanged: [],
  variantsImagesChanged: [],
  variantsAdded: [],
  variantsRemoved: [],
  inventoryOnlyChanged: [],
  pricesOnlyChanged: [],
  lifecycleChanged: false,
};

const fullBody = {
  name: "Bague test",
  description: "desc",
  lifecycle_state: "PUBLISHED",
  taxonomy_type: { id: "tt_123" },
  variant_option_sets: [{ name: "Color", values: ["Argent"] }],
  variants: [
    { id: "po_existing", sku: "sku-argent", options: [{ name: "Color", value: "Argent" }] },
  ],
};

describe("buildPatchBody — lifecycle robustness", () => {
  it("inclut lifecycle_state quand productChanged est vrai (même si diff lifecycleChanged=false)", () => {
    const diff = { ...emptyDiff, productChanged: true };
    const out = buildPatchBody(diff, fullBody, false, false);
    expect(out.lifecycle_state).toBe("PUBLISHED");
    expect(out.name).toBe("Bague test");
  });

  it("inclut lifecycle_state quand de nouvelles variantes sont ajoutées", () => {
    const out = buildPatchBody(emptyDiff, fullBody, false, true);
    expect(out.lifecycle_state).toBe("PUBLISHED");
  });

  it("sans nouvelle variante, n'inclut PAS variants[] ni variant_option_sets dans le PATCH produit", () => {
    const out = buildPatchBody(
      { ...emptyDiff, productChanged: true },
      fullBody,
      false,
      false,
    );
    // Les modifs des variantes existantes passent par PATCH /variants/{id} dédié.
    expect(out.variants).toBeUndefined();
    expect(out.variant_option_sets).toBeUndefined();
  });

  it("inclut variants[] + variant_option_sets quand de nouvelles variantes sont ajoutées (création + déclaration de la nouvelle valeur d'option en un seul PATCH)", () => {
    const out = buildPatchBody(
      emptyDiff,
      {
        ...fullBody,
        variant_option_sets: [
          { name: "Color", values: ["Argent", "Doré", "Marron"] },
        ],
        variants: [
          { id: "po_argent", sku: "sku-argent", options: [{ name: "Color", value: "Argent" }] },
          { id: "po_dore", sku: "sku-dore", options: [{ name: "Color", value: "Doré" }] },
          { sku: "sku-marron", options: [{ name: "Color", value: "Marron" }] },
        ],
      },
      false,
      true,
    );
    expect(out.variant_option_sets).toEqual([
      { name: "Color", values: ["Argent", "Doré", "Marron"] },
    ]);
    expect(out.lifecycle_state).toBe("PUBLISHED");
    // variants[] doit être présent : 2 existantes avec `id`, 1 nouvelle sans
    expect(Array.isArray(out.variants)).toBe(true);
    expect((out.variants as unknown[]).length).toBe(3);
  });

  it("n'inclut PAS lifecycle_state quand aucun PATCH n'est nécessaire", () => {
    const out = buildPatchBody(emptyDiff, fullBody, false, false);
    expect(out.lifecycle_state).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("inclut lifecycle_state quand lifecycleChanged est vrai (cas nominal)", () => {
    const diff = { ...emptyDiff, lifecycleChanged: true };
    const out = buildPatchBody(diff, { ...fullBody, lifecycle_state: "UNPUBLISHED" }, false, false);
    expect(out.lifecycle_state).toBe("UNPUBLISHED");
  });

  it("court-circuit pricesOnly retourne un body vide (pas de PATCH produit)", () => {
    const diff = { ...emptyDiff, pricesOnlyChanged: ["sku1"] };
    const out = buildPatchBody(diff, fullBody, true, false);
    expect(out).toEqual({});
  });
});

describe("buildPatchBody — images conditionnelles", () => {
  const bodyWithImages = {
    ...fullBody,
    images: [{ url: "https://example/a.jpg" }, { url: "https://example/b.jpg" }],
  };

  it("n'inclut PAS images quand productChanged=true mais productImagesChanged=false", () => {
    const diff = { ...emptyDiff, productChanged: true, productImagesChanged: false };
    const out = buildPatchBody(diff, bodyWithImages, false, false);
    expect(out.name).toBe("Bague test");
    expect(out.images).toBeUndefined();
  });

  it("inclut images quand productImagesChanged=true", () => {
    const diff = { ...emptyDiff, productChanged: true, productImagesChanged: true };
    const out = buildPatchBody(diff, bodyWithImages, false, false);
    expect(out.images).toEqual(bodyWithImages.images);
  });

  it("retire images des variantes EXISTANTES (avec id) dont les images n'ont pas changé, dans le PATCH consolidé", () => {
    const bodyWithVariantImages = {
      ...fullBody,
      variants: [
        {
          id: "po_argent",
          sku: "sku-argent",
          options: [{ name: "Color", value: "Argent" }],
          images: [{ url: "https://example/argent.jpg" }],
        },
        {
          id: "po_dore",
          sku: "sku-dore",
          options: [{ name: "Color", value: "Doré" }],
          images: [{ url: "https://example/dore.jpg" }],
        },
        {
          sku: "sku-marron",
          options: [{ name: "Color", value: "Marron" }],
          images: [{ url: "https://example/marron.jpg" }],
        },
      ],
    };
    const diff = {
      ...emptyDiff,
      variantsImagesChanged: ["sku-marron"], // que la nouvelle variante
    };
    const out = buildPatchBody(diff, bodyWithVariantImages, false, true);
    const outVariants = out.variants as Array<Record<string, unknown>>;
    expect(outVariants).toHaveLength(3);
    // Variante existante Argent : images retirées
    const argent = outVariants.find((v) => v.sku === "sku-argent")!;
    expect(argent.images).toBeUndefined();
    // Variante existante Doré : images retirées
    const dore = outVariants.find((v) => v.sku === "sku-dore")!;
    expect(dore.images).toBeUndefined();
    // Nouvelle variante Marron : images conservées (création)
    const marron = outVariants.find((v) => v.sku === "sku-marron")!;
    expect(marron.images).toEqual([{ url: "https://example/marron.jpg" }]);
  });

  it("garde les images des variantes existantes dont les images ont effectivement changé", () => {
    const bodyWithVariantImages = {
      ...fullBody,
      variants: [
        {
          id: "po_argent",
          sku: "sku-argent",
          options: [{ name: "Color", value: "Argent" }],
          images: [{ url: "https://example/argent-new.jpg" }],
        },
      ],
    };
    const diff = {
      ...emptyDiff,
      variantsImagesChanged: ["sku-argent"],
    };
    const out = buildPatchBody(diff, bodyWithVariantImages, false, true);
    const outVariants = out.variants as Array<Record<string, unknown>>;
    expect(outVariants[0].images).toEqual([{ url: "https://example/argent-new.jpg" }]);
  });
});
