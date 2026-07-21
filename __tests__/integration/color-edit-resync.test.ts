/**
 * Integration tests : updateColorDirect retourne nameChanged / pfsColorRefChanged
 * et la liste des produits affectés pour piloter la modale de re-sync marketplace.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { updateColorDirect } from "@/app/actions/admin/colors";

describe("updateColorDirect — retour enrichi", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    // Crée un produit avec color1 en variante + couleur primaire — sert aux 4 tests.
    await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}EDIT-USE`,
        name: "Produit témoin",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        countryIsoCode: entities.country.id,
        status: "OFFLINE",
        primaryColorId: entities.color1.id,
        colors: {
          create: [
            {
              colorId: entities.color1.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 1,
              isPrimary: true,
              saleType: "UNIT",
            },
          ],
        },
      },
    });
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  it("retourne nameChanged=true quand seul le nom change", async () => {
    const before = await prisma.color.findUnique({ where: { id: entities.color1.id } });
    const res = await updateColorDirect(
      entities.color1.id,
      before!.name + "X",
      before!.hex,
      {},
      undefined,
      before!.pfsColorRef,
    );
    expect(res.nameChanged).toBe(true);
    expect(res.pfsColorRefChanged).toBe(false);
    expect(res.affectedProducts.length).toBeGreaterThanOrEqual(1);
  });

  it("retourne pfsColorRefChanged=true quand seule la ref PFS change", async () => {
    const before = await prisma.color.findUnique({ where: { id: entities.color1.id } });
    const res = await updateColorDirect(
      entities.color1.id,
      before!.name,
      before!.hex,
      {},
      undefined,
      "AUTRE_REF_PFS",
    );
    expect(res.nameChanged).toBe(false);
    expect(res.pfsColorRefChanged).toBe(true);
    expect(res.affectedProducts.length).toBeGreaterThanOrEqual(1);
  });

  it("retourne les deux flags à true quand nom + ref PFS changent ensemble", async () => {
    const before = await prisma.color.findUnique({ where: { id: entities.color1.id } });
    const res = await updateColorDirect(
      entities.color1.id,
      before!.name + "Y",
      before!.hex,
      {},
      undefined,
      "ENCORE_AUTRE_REF",
    );
    expect(res.nameChanged).toBe(true);
    expect(res.pfsColorRefChanged).toBe(true);
  });

  it("retourne affectedProducts vide quand seul le hex change", async () => {
    const before = await prisma.color.findUnique({ where: { id: entities.color1.id } });
    const res = await updateColorDirect(
      entities.color1.id,
      before!.name,
      "#abcdef",
      {},
      undefined,
      before!.pfsColorRef,
    );
    expect(res.nameChanged).toBe(false);
    expect(res.pfsColorRefChanged).toBe(false);
    expect(res.affectedProducts).toEqual([]);
  });
});
