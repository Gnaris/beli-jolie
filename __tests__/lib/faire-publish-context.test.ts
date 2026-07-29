/**
 * `buildPublishContext` alimente la description Faire avec :
 *  - la ligne composition ;
 *  - la ligne taille (avec cas spécial « Taille Unique (XX-YY) ») ;
 *  - la ligne « Made in {pays en anglais} » résolue via Intl.DisplayNames à
 *    partir de `manufacturingCountry.isoCode`.
 *
 * Sans dépendance Prisma — la fonction est pure sur l'objet produit reçu.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/faire-api", () => ({ faireFetch: vi.fn() }));

import { buildPublishContext } from "@/lib/faire-publish";

type Product = Parameters<typeof buildPublishContext>[0];

function makeProduct(overrides: Partial<Product> = {}): Product {
  const base: Product = {
    category: { id: "cat", faireTaxonomyId: "tt_test" },
    hsCode: { code: "7117.19.00" },
    countryIsoCode: "CN",
    compositions: [{ percentage: 100, composition: { name: "Acier" } }],
    description: "Bracelet.",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    colors: [],
    sizeDetailsTu: null,
  };
  return { ...base, ...overrides };
}

function unitVariantWithSizes(sizeNames: string[]): Product["colors"][number] {
  return {
    id: `v-${sizeNames.join("-")}`,
    faireVariantId: null,
    unitPrice: 10,
    weight: 0.02,
    stock: 5,
    isPrimary: false,
    saleType: "UNIT",
    packQuantity: null,
    colorId: "c",
    color: { id: "c", name: "Or" },
    variantSizes: sizeNames.map((n) => ({ size: { name: n }, quantity: 1 })),
    packLines: [],
  };
}

describe("buildPublishContext — description enrichie (taille + made in)", () => {
  it("ajoute « Taille Unique (38-42) » quand une seule taille TU + sizeDetailsTu", () => {
    const ctx = buildPublishContext(
      makeProduct({
        sizeDetailsTu: "38-42",
        colors: [unitVariantWithSizes(["Taille Unique"])],
      }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Taille Unique (38-42)");
  });

  it("ajoute « Tailles : S, M, L » quand plusieurs tailles distinctes", () => {
    const ctx = buildPublishContext(
      makeProduct({
        colors: [unitVariantWithSizes(["S", "M", "L"])],
      }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Tailles : S, M, L");
  });

  it("dédup les tailles quand chaque couleur porte les mêmes", () => {
    const ctx = buildPublishContext(
      makeProduct({
        colors: [
          unitVariantWithSizes(["S", "M"]),
          unitVariantWithSizes(["S", "M"]),
        ],
      }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Tailles : S, M");
    expect(ctx.ctx?.description).not.toContain("S, M, S");
  });

  it("ignore les variantes PACK pour la collecte des tailles", () => {
    const ctx = buildPublishContext(
      makeProduct({
        colors: [
          { ...unitVariantWithSizes(["S", "M"]) },
          {
            ...unitVariantWithSizes(["XXL"]),
            saleType: "PACK",
            packQuantity: 3,
          },
        ],
      }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Tailles : S, M");
    expect(ctx.ctx?.description).not.toContain("XXL");
  });

  it("ajoute « Made in China » à partir de l'isoCode CN", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "CN" }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in China");
  });

  it("ajoute « Made in France » à partir de l'isoCode FR", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "FR" }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in France");
  });

  it("ajoute « Made in Italy » à partir de l'isoCode IT", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "IT" }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in Italy");
  });

  it("n'ajoute PAS de ligne « Made in » quand aucun pays renseigné (pas de fallback CN dans la description)", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: null }),
    );
    expect(ctx.ok).toBe(true);
    // Le champ marketplace `countryAlpha2` retombe bien sur CN (fallback
    // historique du POST /products), mais la description doit rester silencieuse
    // pour éviter un « Made in China » erroné sur d'autres tenants.
    expect(ctx.ctx?.countryAlpha2).toBe("CN");
    expect(ctx.ctx?.countryUsedFallback).toBe(true);
    expect(ctx.ctx?.description).not.toContain("Made in");
  });

  it("combine composition + taille + made in dans la même description", () => {
    const ctx = buildPublishContext(
      makeProduct({
        description: "Bracelet acier fin.",
        compositions: [{ percentage: 100, composition: { name: "Acier 316L" } }],
        sizeDetailsTu: "38-42",
        colors: [unitVariantWithSizes(["Taille Unique"])],
        countryIsoCode: "CN",
      }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toBe(
      "Bracelet acier fin.\n\n" +
      "Composition : Acier 316L (100%)\n\n" +
      "Taille Unique (38-42)\n\n" +
      "Made in China",
    );
  });
});

describe("buildPublishContext — exclusion « Made in » configurable", () => {
  it("omet « Made in {pays} » quand l'isoCode est dans la liste d'exclusion", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "CN", description: "Bracelet." }),
      { excludedMadeInIsoCodes: ["CN"] },
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).not.toContain("Made in");
    // countryAlpha2 reste envoyé sur le POST Faire — seule la description est
    // filtrée.
    expect(ctx.ctx?.countryAlpha2).toBe("CN");
  });

  it("conserve « Made in » quand l'isoCode n'est PAS dans la liste", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "FR", description: "Bracelet." }),
      { excludedMadeInIsoCodes: ["CN", "IT"] },
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in France");
  });

  it("normalise la casse : « cn » minuscule dans la liste exclut aussi", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "CN" }),
      { excludedMadeInIsoCodes: ["cn"] },
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).not.toContain("Made in");
  });

  it("liste vide : comportement identique à l'ancien (mention affichée)", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "CN" }),
      { excludedMadeInIsoCodes: [] },
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in China");
  });

  it("option non passée : comportement identique à l'ancien (mention affichée)", () => {
    const ctx = buildPublishContext(
      makeProduct({ countryIsoCode: "IT" }),
    );
    expect(ctx.ok).toBe(true);
    expect(ctx.ctx?.description).toContain("Made in Italy");
  });
});
