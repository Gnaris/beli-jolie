/**
 * Integration test : fusion d'une variante supprimée puis ré-ajoutée avant Save.
 *
 * Scénario reproduit : l'admin supprime la variante d'une couleur dans le
 * formulaire produit, puis la ré-ajoute (toujours sans avoir cliqué « Enregistrer »).
 * Au Save, on doit garder l'ancienne variante (id stable, images, liaisons
 * marketplaces eFashion/PFS/Ankorstore) au lieu de la détruire + en recréer
 * une nouvelle vide.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import {
  createProduct,
  updateProduct,
  type ProductInput,
} from "@/app/actions/admin/products";

describe("Variant merge — suppression + re-ajout avant Save (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let productId: string;
  let initialVariantId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    // Crée un produit avec 2 variantes UNIT : Doré (primaire) + Argenté.
    const input: ProductInput = {
      reference: `${TEST_PREFIX}MERGE-001`,
      name: "Bague test fusion variante",
      description: "Description test",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.1,
          stock: 5,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
        {
          colorId: entities.color2.id,
          unitPrice: 11,
          weight: 0.1,
          stock: 3,
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "OFFLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
    };
    const created = await createProduct(input);
    productId = created.id;

    // Pose des identifiants marketplaces fictifs sur la variante Argenté
    // pour pouvoir vérifier qu'ils sont préservés après la fusion.
    const argenteVariant = await prisma.productColor.findFirst({
      where: { productId, colorId: entities.color2.id },
      select: { id: true },
    });
    expect(argenteVariant).not.toBeNull();
    initialVariantId = argenteVariant!.id;
    await prisma.productColor.update({
      where: { id: initialVariantId },
      data: {
        efashionProductId: 9999001,
        pfsVariantId: "PFS-9999",
        ankorsVariantId: "AS-9999",
      },
    });

    // Pose aussi une image attachée à la couleur Argenté pour vérifier qu'elle
    // survit à la fusion (les ProductColorImage sont liées par colorId, donc en
    // théorie elles ne sont pas censées disparaître — ce test garantit le
    // contrat).
    await prisma.productColorImage.create({
      data: {
        productId,
        colorId: entities.color2.id,
        path: "/uploads/produits/test/argente-1.webp",
        order: 0,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("préserve l'id de variante, les liaisons marketplaces et les images quand on supprime+ré-ajoute la même couleur avant Save", async () => {
    // Simule le formulaire après suppression + ré-ajout de la couleur Argenté :
    //   - on garde la variante Doré (avec son dbId)
    //   - on remet Argenté sans dbId (= nouvelle, comme si l'admin venait
    //     de cliquer « + Ajouter une couleur »)
    const updateInput: ProductInput = {
      reference: `${TEST_PREFIX}MERGE-001`,
      name: "Bague test fusion variante",
      description: "Description test",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          // Doré reste lié par son dbId
          dbId: (await prisma.productColor.findFirst({
            where: { productId, colorId: entities.color1.id },
            select: { id: true },
          }))!.id,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.1,
          stock: 5,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
        {
          // Argenté ré-ajoutée SANS dbId (= comportement React après delete+add)
          colorId: entities.color2.id,
          unitPrice: 12, // prix modifié par rapport à l'initial (11)
          weight: 0.1,
          stock: 7, // stock modifié aussi
          isPrimary: false,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "OFFLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
    };

    await updateProduct(productId, updateInput);

    // 1. La variante Argenté doit avoir CONSERVÉ son id initial.
    const variantsAfter = await prisma.productColor.findMany({
      where: { productId },
      select: {
        id: true,
        colorId: true,
        unitPrice: true,
        stock: true,
        efashionProductId: true,
        pfsVariantId: true,
        ankorsVariantId: true,
      },
    });
    expect(variantsAfter).toHaveLength(2);
    const argenteAfter = variantsAfter.find(
      (v) => v.colorId === entities.color2.id,
    );
    expect(argenteAfter).toBeDefined();
    expect(argenteAfter!.id).toBe(initialVariantId);

    // 2. Les liaisons marketplaces (eFashion, PFS, Ankorstore) doivent être préservées.
    expect(argenteAfter!.efashionProductId).toBe(9999001);
    expect(argenteAfter!.pfsVariantId).toBe("PFS-9999");
    expect(argenteAfter!.ankorsVariantId).toBe("AS-9999");

    // 3. Les nouvelles valeurs (prix, stock) doivent être appliquées.
    expect(Number(argenteAfter!.unitPrice)).toBe(12);
    expect(argenteAfter!.stock).toBe(7);

    // 4. Les images attachées à la couleur Argenté restent.
    const images = await prisma.productColorImage.findMany({
      where: { productId, colorId: entities.color2.id },
    });
    expect(images.length).toBeGreaterThan(0);
  });
});
