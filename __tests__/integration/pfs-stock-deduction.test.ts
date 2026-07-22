/**
 * Integration tests : déduction du stock à partir des commandes PFS validées/envoyées.
 *
 * Couvre : idempotence, floor à 0, filtres de statut, PACK cascade, marquage important.
 * Utilise la vraie DB. Aucun appel réseau PFS — on inject les rows PfsOrder/PfsOrderItem
 * à la main.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { Prisma } from "@prisma/client";
import {
  countPendingPfsStockDeductions,
  deductStockFromPfsOrders,
} from "@/lib/pfs-stock-deduction";

const TENANT_SLUG = "beli-jolie";
async function getTenantId() {
  const t = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!t) throw new Error("Tenant beli-jolie introuvable");
  return t.id;
}

async function makePfsOrder(opts: {
  tenantId: string;
  status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED";
  suffix: string;
}) {
  return prisma.pfsOrder.create({
    data: {
      tenantId: opts.tenantId,
      pfsOrderId: `${TEST_PREFIX}pfs_ord_${opts.suffix}`,
      orderNumber: `${TEST_PREFIX}PO#${opts.suffix}`,
      status: opts.status,
      createdAtPfs: new Date("2026-07-01T10:00:00Z"),
      totalHT: new Prisma.Decimal(100),
      totalTTC: new Prisma.Decimal(120),
      vatAmount: new Prisma.Decimal(20),
      vatRate: new Prisma.Decimal(20),
      totalOrderedQty: 1,
      totalValidatedQty: 1,
      uniqueReferences: 1,
      hasInvoice: false,
      hasCredit: false,
      pfsCustomerId: `${TEST_PREFIX}cus_${opts.suffix}`,
      customerName: "Test Customer",
      statusTimelineJson: {} as unknown as Prisma.InputJsonValue,
      rawDetailJson: {} as unknown as Prisma.InputJsonValue,
    },
  });
}

async function makePfsItem(opts: {
  tenantId: string;
  pfsOrderId: string;
  productId: string;
  productColorId: string | null;
  suffix: string;
  qtyValidated: number;
  sizeLabel: string;
  colorLabelFr?: string;
}) {
  return prisma.pfsOrderItem.create({
    data: {
      tenantId: opts.tenantId,
      pfsOrderId: opts.pfsOrderId,
      pfsItemId: `${TEST_PREFIX}pfs_item_${opts.suffix}`,
      pfsProductRef: `${TEST_PREFIX}REF_${opts.suffix}`,
      pfsSku: `${TEST_PREFIX}SKU_${opts.suffix}`,
      productId: opts.productId,
      productColorId: opts.productColorId,
      colorLabelFr: opts.colorLabelFr ?? "Or",
      colorCodePfs: "GOLDEN",
      sizeLabel: opts.sizeLabel,
      itemType: "ITEM",
      qtyOrdered: opts.qtyValidated,
      qtyValidated: opts.qtyValidated,
      unitPriceHT: new Prisma.Decimal(10),
      totalPriceHT: new Prisma.Decimal(10 * opts.qtyValidated),
    },
  });
}

async function cleanupPfsData(tenantId: string) {
  await prisma.pfsOrderItem.deleteMany({
    where: { tenantId, pfsItemId: { startsWith: `${TEST_PREFIX}pfs_item_` } },
  });
  await prisma.pfsOrder.deleteMany({
    where: { tenantId, pfsOrderId: { startsWith: `${TEST_PREFIX}pfs_ord_` } },
  });
  await prisma.stockMovement.deleteMany({
    where: { tenantId, reason: { contains: TEST_PREFIX } },
  });
}

describe("PFS stock deduction (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let tenantId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
    tenantId = await getTenantId();
  });

  afterAll(async () => {
    await cleanupPfsData(tenantId);
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupPfsData(tenantId);
  });

  it("décrémente une ligne UNIT et marque stockDeductedAt + important", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}UNIT-1`,
        name: "Bague Or",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
        important: false,
      },
    });
    const variant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 20,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: {
          create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }],
        },
      },
    });

    const baselinePending = await countPendingPfsStockDeductions(tenantId);
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "u1" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u1",
      qtyValidated: 5,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    const pendingAfterInsert = await countPendingPfsStockDeductions(tenantId);
    expect(pendingAfterInsert).toBe(baselinePending + 1);

    const res = await deductStockFromPfsOrders(tenantId, null);
    expect(res.processedCount).toBeGreaterThanOrEqual(1);
    expect(res.touchedProductIds).toContain(product.id);

    const v = await prisma.productColor.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(15);
    const p = await prisma.product.findUnique({ where: { id: product.id } });
    expect(p?.important).toBe(true);
    const mov = await prisma.stockMovement.findFirst({
      where: { productColorId: variant.id },
    });
    expect(mov?.quantity).toBe(-5);
  });

  it("skip si productId null", async () => {
    // Doublon volontaire du test plus bas : garde-fou de non-régression sur le
    // filtre WHERE de countPendingPfsStockDeductions.
    const baselinePending = await countPendingPfsStockDeductions(tenantId);
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "unlinked" });
    await prisma.pfsOrderItem.create({
      data: {
        tenantId,
        pfsOrderId: order.id,
        pfsItemId: `${TEST_PREFIX}pfs_item_unlinked`,
        pfsProductRef: `${TEST_PREFIX}REF_UNLINKED`,
        pfsSku: `${TEST_PREFIX}SKU_UNLINKED`,
        productId: null,
        productColorId: null,
        colorLabelFr: "Or",
        sizeLabel: `${TEST_PREFIX}TU`,
        itemType: "ITEM",
        qtyOrdered: 3,
        qtyValidated: 3,
        unitPriceHT: new Prisma.Decimal(10),
        totalPriceHT: new Prisma.Decimal(30),
      },
    });
    // productId null → doit rester sur baseline
    expect(await countPendingPfsStockDeductions(tenantId)).toBe(baselinePending);
  });

  it("est idempotent : 2ᵉ appel ne re-décrémente pas", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}UNIT-2`,
        name: "Bague Or 2",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const variant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 10,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const order = await makePfsOrder({ tenantId, status: "SENT", suffix: "u2" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u2",
      qtyValidated: 3,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    await deductStockFromPfsOrders(tenantId, null);
    const res2 = await deductStockFromPfsOrders(tenantId, null);
    expect(res2.processedCount).toBe(0);

    const v = await prisma.productColor.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(7);
  });

  it("floor à 0 : ne descend jamais en négatif", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}UNIT-3`,
        name: "Bague Or 3",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const variant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 2,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "u3" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u3",
      qtyValidated: 10,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    await deductStockFromPfsOrders(tenantId, null);
    const v = await prisma.productColor.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(0);
  });

  it("ignore les commandes NEW et CANCELLED", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}UNIT-4`,
        name: "Bague Or 4",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const variant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 50,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const orderNew = await makePfsOrder({ tenantId, status: "NEW", suffix: "u4n" });
    await makePfsItem({
      tenantId,
      pfsOrderId: orderNew.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u4n",
      qtyValidated: 5,
      sizeLabel: `${TEST_PREFIX}TU`,
    });
    const orderCan = await makePfsOrder({ tenantId, status: "CANCELLED", suffix: "u4c" });
    await makePfsItem({
      tenantId,
      pfsOrderId: orderCan.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u4c",
      qtyValidated: 5,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    const res = await deductStockFromPfsOrders(tenantId, null);
    expect(res.processedCount).toBe(0);
    const v = await prisma.productColor.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(50);
  });

  it("cascade PACK mono-couleur : recalcule le stock après baisse UNIT", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}PACK-1`,
        name: "Bague Or PACK",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    // Variante UNIT taille TU stock 6
    const unitVariant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 6,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    // Variante PACK x3 même couleur, contient 3 pièces taille TU → stock doit tomber à floor(0/3)=0 après vente
    const packVariant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(25),
        weight: 0.3,
        stock: 99,
        isPrimary: false,
        saleType: "PACK",
        packQuantity: 3,
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 3 }] },
      },
    });

    // On vend 6 unités UNIT → stock UNIT tombe à 0 → PACK x3 doit tomber à 0
    const order = await makePfsOrder({ tenantId, status: "SENT", suffix: "p1" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: unitVariant.id,
      suffix: "p1",
      qtyValidated: 6,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    await deductStockFromPfsOrders(tenantId, null);
    const u = await prisma.productColor.findUnique({ where: { id: unitVariant.id } });
    const p = await prisma.productColor.findUnique({ where: { id: packVariant.id } });
    expect(u?.stock).toBe(0);
    expect(p?.stock).toBe(0);
  });

  it("cascade PACK mono-couleur : stock partiel = floor(unit/quantity)", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}PACK-2`,
        name: "Bague Or PACK 2",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const unitVariant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 20,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const packX3 = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(25),
        weight: 0.3,
        stock: 99,
        isPrimary: false,
        saleType: "PACK",
        packQuantity: 3,
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 3 }] },
      },
    });
    const packX7 = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(50),
        weight: 0.7,
        stock: 99,
        isPrimary: false,
        saleType: "PACK",
        packQuantity: 7,
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 7 }] },
      },
    });

    // Vend 14 UNIT → stock UNIT tombe à 6. PACK x3 = 2, PACK x7 = 0.
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "p2" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: unitVariant.id,
      suffix: "p2",
      qtyValidated: 14,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    await deductStockFromPfsOrders(tenantId, null);
    const u = await prisma.productColor.findUnique({ where: { id: unitVariant.id } });
    const p3 = await prisma.productColor.findUnique({ where: { id: packX3.id } });
    const p7 = await prisma.productColor.findUnique({ where: { id: packX7.id } });
    expect(u?.stock).toBe(6);
    expect(p3?.stock).toBe(2);
    expect(p7?.stock).toBe(0);
  });

  it("vente PACK : décrémente les UNIT correspondants × packQuantity", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}PACK-3`,
        name: "Bague Or PACK 3",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const unitVariant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 100,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const packX12 = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(100),
        weight: 1.2,
        stock: 99,
        isPrimary: false,
        saleType: "PACK",
        packQuantity: 12,
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 12 }] },
      },
    });

    // Vend 2 PACKS x12 → doit décrémenter 24 UNIT
    const order = await makePfsOrder({ tenantId, status: "SENT", suffix: "p3" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: packX12.id,
      suffix: "p3",
      qtyValidated: 2,
      sizeLabel: `${TEST_PREFIX}TU`,
    });

    await deductStockFromPfsOrders(tenantId, null);
    const u = await prisma.productColor.findUnique({ where: { id: unitVariant.id } });
    expect(u?.stock).toBe(76);
  });

  it("skip si productId null", async () => {
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "u5" });
    // Injection direct sans productId (contourne makePfsItem qui exige productId)
    await prisma.pfsOrderItem.create({
      data: {
        tenantId,
        pfsOrderId: order.id,
        pfsItemId: `${TEST_PREFIX}pfs_item_u5`,
        pfsProductRef: `${TEST_PREFIX}REF_U5`,
        pfsSku: `${TEST_PREFIX}SKU_U5`,
        productId: null,
        productColorId: null,
        colorLabelFr: "Or",
        sizeLabel: `${TEST_PREFIX}TU`,
        itemType: "ITEM",
        qtyOrdered: 3,
        qtyValidated: 3,
        unitPriceHT: new Prisma.Decimal(10),
        totalPriceHT: new Prisma.Decimal(30),
      },
    });
    // Count filtre déjà productId null → 0
    expect(await countPendingPfsStockDeductions(tenantId)).toBe(0);
    const res = await deductStockFromPfsOrders(tenantId, null);
    expect(res.processedCount).toBe(0);
    expect(res.skipped).toEqual([]);
  });

  it("skip si sizeLabel inconnu", async () => {
    const product = await prisma.product.create({
      data: {
        tenantId,
        reference: `${TEST_PREFIX}UNIT-6`,
        name: "Bague Or 6",
        description: "",
        categoryId: entities.category.id,
        status: "OFFLINE",
      },
    });
    const variant = await prisma.productColor.create({
      data: {
        tenantId,
        productId: product.id,
        colorId: entities.color1.id,
        unitPrice: new Prisma.Decimal(10),
        weight: 0.1,
        stock: 10,
        isPrimary: true,
        saleType: "UNIT",
        variantSizes: { create: [{ tenantId, sizeId: entities.size.id, quantity: 1 }] },
      },
    });
    const order = await makePfsOrder({ tenantId, status: "VALIDATED", suffix: "u6" });
    await makePfsItem({
      tenantId,
      pfsOrderId: order.id,
      productId: product.id,
      productColorId: variant.id,
      suffix: "u6",
      qtyValidated: 3,
      sizeLabel: "TAILLE_INCONNUE_XYZ",
    });

    const res = await deductStockFromPfsOrders(tenantId, null);
    expect(res.processedCount).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect(res.skipped[0]?.reason).toBe("SIZE_UNKNOWN");
    const v = await prisma.productColor.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(10);
  });
});
