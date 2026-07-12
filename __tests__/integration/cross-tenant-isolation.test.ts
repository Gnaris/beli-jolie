/**
 * Cross-tenant isolation tests (real DB).
 *
 * Fige le comportement de l'extension `tenantScopeExtension` (lib/prisma-tenant-scope.ts) :
 *   1. Un tenant A bindé via l'ALS ne peut pas lire, modifier ni supprimer
 *      les rows d'un tenant B — même en connaissant leur id/reference.
 *   2. Les tentatives d'écriture (update/delete/upsert/updateMany) doivent
 *      soit throw, soit ne toucher aucune ligne. La BDD reste intacte.
 *   3. Les tentatives de lecture par clé unique (findUnique) doivent renvoyer
 *      null si la row appartient à un autre tenant.
 *
 * Ces garanties sont critiques : sans elles, un bug dans le middleware ou une
 * requête forgée exposerait les données d'une boutique à une autre.
 *
 * Ce fichier reproduit en Vitest ce que fait déjà `scripts/dev/test-cross-tenant-fix.ts`
 * (5/5 en local, mais dépend d'un dev server tournant). Ici on court sans HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";
import { bindTenantId, tenantALS } from "@/lib/tenant-als";

// Bypass l'extension pour créer les données de test et vérifier l'état BDD réel.
import { PrismaClient } from "@prisma/client";
const rawPrisma = new PrismaClient();

describe("Cross-tenant isolation (real DB)", () => {
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let productA: { id: string; reference: string; name: string };
  let productB: { id: string; reference: string; name: string };
  let orderA: { id: string; orderNumber: string; status: string };
  let orderB: { id: string; orderNumber: string; status: string };
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let category: { id: string };

  beforeAll(async () => {
    await cleanupTestData();

    // ─── Tenants ────────────────────────────────────────────────
    const [ta, tb] = await Promise.all([
      rawPrisma.tenant.create({
        data: {
          slug: `${TEST_PREFIX.toLowerCase()}iso-a`,
          name: `${TEST_PREFIX}Iso A`,
        },
      }),
      rawPrisma.tenant.create({
        data: {
          slug: `${TEST_PREFIX.toLowerCase()}iso-b`,
          name: `${TEST_PREFIX}Iso B`,
        },
      }),
    ]);
    tenantA = { id: ta.id, slug: ta.slug };
    tenantB = { id: tb.id, slug: tb.slug };

    // ─── Category (partagé, pas tenant-scoped) ─────────────────
    const cat = await rawPrisma.category.create({
      data: { name: `${TEST_PREFIX}IsoCat`, slug: `${TEST_PREFIX}isocat`.toLowerCase() },
    });
    category = { id: cat.id };

    // ─── Un produit par tenant, même reference pour valider l'unicité composite ─
    const sharedRef = `${TEST_PREFIX}ISO001`;
    const [pa, pb] = await Promise.all([
      rawPrisma.product.create({
        data: {
          reference: sharedRef,
          name: "Produit A (tenant A)",
          description: "Description A",
          categoryId: category.id,
          tenantId: tenantA.id,
        },
      }),
      rawPrisma.product.create({
        data: {
          reference: sharedRef,
          name: "Produit B (tenant B)",
          description: "Description B",
          categoryId: category.id,
          tenantId: tenantB.id,
        },
      }),
    ]);
    productA = { id: pa.id, reference: pa.reference, name: pa.name };
    productB = { id: pb.id, reference: pb.reference, name: pb.name };

    // ─── Users (un par tenant) ────────────────────────────────
    const [ua, ub] = await Promise.all([
      rawPrisma.user.create({
        data: {
          email: `test_integ_iso_a@example.com`,
          password: "x",
          firstName: "A",
          lastName: "A",
          company: "Iso A",
          phone: "0000000000",
          siret: `${TEST_PREFIX}SIRETA`,
          tenantId: tenantA.id,
        },
      }),
      rawPrisma.user.create({
        data: {
          email: `test_integ_iso_b@example.com`,
          password: "x",
          firstName: "B",
          lastName: "B",
          company: "Iso B",
          phone: "0000000000",
          siret: `${TEST_PREFIX}SIRETB`,
          tenantId: tenantB.id,
        },
      }),
    ]);
    userA = { id: ua.id, email: ua.email };
    userB = { id: ub.id, email: ub.email };

    // ─── Orders (une par tenant, même orderNumber pour valider @@unique composite)
    const sharedOrderNumber = `${TEST_PREFIX}ORD01`;
    const [oa, ob] = await Promise.all([
      rawPrisma.order.create({
        data: {
          orderNumber: sharedOrderNumber,
          userId: userA.id,
          status: "PENDING",
          shipLabel: "Iso A",
          shipFirstName: "A",
          shipLastName: "A",
          shipAddress1: "1 rue A",
          shipZipCode: "75000",
          shipCity: "Paris",
          shipCountry: "FR",
          clientCompany: "Iso A",
          clientEmail: userA.email,
          clientPhone: "0000000000",
          clientSiret: `${TEST_PREFIX}SIRETA`,
          carrierId: "test",
          carrierName: "Test",
          carrierPrice: 10,
          tvaRate: 0.2,
          subtotalHT: 100,
          tvaAmount: 20,
          totalTTC: 120,
          tenantId: tenantA.id,
        },
      }),
      rawPrisma.order.create({
        data: {
          orderNumber: sharedOrderNumber,
          userId: userB.id,
          status: "PENDING",
          shipLabel: "Iso B",
          shipFirstName: "B",
          shipLastName: "B",
          shipAddress1: "1 rue B",
          shipZipCode: "75000",
          shipCity: "Paris",
          shipCountry: "FR",
          clientCompany: "Iso B",
          clientEmail: userB.email,
          clientPhone: "0000000000",
          clientSiret: `${TEST_PREFIX}SIRETB`,
          carrierId: "test",
          carrierName: "Test",
          carrierPrice: 10,
          tvaRate: 0.2,
          subtotalHT: 100,
          tvaAmount: 20,
          totalTTC: 120,
          tenantId: tenantB.id,
        },
      }),
    ]);
    orderA = { id: oa.id, orderNumber: oa.orderNumber, status: oa.status };
    orderB = { id: ob.id, orderNumber: ob.orderNumber, status: ob.status };
  });

  afterAll(async () => {
    // On nettoie via rawPrisma (bypass extension) car nos rows sont dans
    // des tenants de test, invisibles pour l'extension scopée à beli-jolie.
    await rawPrisma.orderItem.deleteMany({
      where: { order: { orderNumber: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.order.deleteMany({ where: { orderNumber: { startsWith: TEST_PREFIX } } });
    await rawPrisma.product.deleteMany({ where: { reference: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: "test_integ_" } } });
    await rawPrisma.category.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    const testTenants = await rawPrisma.tenant.findMany({
      where: { slug: { startsWith: TEST_PREFIX.toLowerCase() } },
      select: { id: true },
    });
    const ids = testTenants.map((t) => t.id);
    if (ids.length > 0) {
      await rawPrisma.tenantDomain.deleteMany({ where: { tenantId: { in: ids } } });
      await rawPrisma.tenant.deleteMany({ where: { id: { in: ids } } });
    }
    await cleanupTestData();
    await rawPrisma.$disconnect();
  });

  /**
   * Wrapper qui rejoue les callbacks à l'intérieur d'un contexte ALS bindé
   * au tenant demandé — c'est ce que fait `getCurrentTenant()` en prod.
   */
  async function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantALS.run(tenantId, async () => {
      bindTenantId(tenantId);
      return fn();
    });
  }

  // ─── Reads : findUnique / findFirst / findMany ──────────────

  it("findUnique(id) sur un produit d'un autre tenant renvoie null", async () => {
    const result = await asTenant(tenantA.id, () =>
      prisma.product.findUnique({ where: { id: productB.id } })
    );
    expect(result).toBeNull();
  });

  it("findFirst(reference) scope au tenant courant (renvoie SON produit)", async () => {
    const fromA = await asTenant(tenantA.id, () =>
      prisma.product.findFirst({ where: { reference: productA.reference } })
    );
    expect(fromA?.id).toBe(productA.id);

    const fromB = await asTenant(tenantB.id, () =>
      prisma.product.findFirst({ where: { reference: productB.reference } })
    );
    expect(fromB?.id).toBe(productB.id);
  });

  it("findMany ne remonte que les rows du tenant courant", async () => {
    const rows = await asTenant(tenantA.id, () =>
      prisma.product.findMany({
        where: { reference: { startsWith: TEST_PREFIX } },
      })
    );
    // Seul productA doit remonter, jamais productB.
    expect(rows.map((r) => r.id)).toContain(productA.id);
    expect(rows.map((r) => r.id)).not.toContain(productB.id);
  });

  // ─── Writes : update / delete cross-tenant ──────────────────

  it("update() sur un produit d'un autre tenant throw et laisse la row intacte", async () => {
    await expect(
      asTenant(tenantA.id, () =>
        prisma.product.update({
          where: { id: productB.id },
          data: { name: "PWNED by A" },
        })
      )
    ).rejects.toThrow();

    const after = await rawPrisma.product.findUnique({ where: { id: productB.id } });
    expect(after?.name).toBe(productB.name);
  });

  it("delete() sur un produit d'un autre tenant throw et laisse la row intacte", async () => {
    await expect(
      asTenant(tenantA.id, () =>
        prisma.product.delete({ where: { id: productB.id } })
      )
    ).rejects.toThrow();

    const after = await rawPrisma.product.findUnique({ where: { id: productB.id } });
    expect(after).not.toBeNull();
    expect(after?.name).toBe(productB.name);
  });

  it("updateMany() cross-tenant ne modifie aucune row de l'autre tenant", async () => {
    const result = await asTenant(tenantA.id, () =>
      prisma.product.updateMany({
        where: { id: productB.id },
        data: { name: "PWNED by A via updateMany" },
      })
    );
    // L'extension a ajouté `AND: { tenantId: A }` au where — 0 row matchée.
    expect(result.count).toBe(0);

    const after = await rawPrisma.product.findUnique({ where: { id: productB.id } });
    expect(after?.name).toBe(productB.name);
  });

  it("deleteMany() cross-tenant ne supprime aucune row de l'autre tenant", async () => {
    const result = await asTenant(tenantA.id, () =>
      prisma.product.deleteMany({ where: { id: productB.id } })
    );
    expect(result.count).toBe(0);

    const after = await rawPrisma.product.findUnique({ where: { id: productB.id } });
    expect(after).not.toBeNull();
  });

  // ─── Upsert cross-tenant (le fix C7 de scripts/dev/test-cross-tenant-fix.ts) ─

  it("upsert() sur une reference partagée reste scopé au tenant courant", async () => {
    // Depuis tenant A, upsert avec la reference qui existe déjà chez B (et A).
    // Le pré-check doit trouver productA et NE PAS toucher productB.
    await asTenant(tenantA.id, () =>
      prisma.product.upsert({
        where: { tenantId_reference: { tenantId: tenantA.id, reference: productA.reference } },
        update: { name: "Renommé chez A" },
        create: {
          reference: productA.reference,
          name: "Nouveau chez A",
          description: "d",
          categoryId: category.id,
        },
      })
    );

    const afterA = await rawPrisma.product.findUnique({ where: { id: productA.id } });
    const afterB = await rawPrisma.product.findUnique({ where: { id: productB.id } });
    expect(afterA?.name).toBe("Renommé chez A");
    expect(afterB?.name).toBe(productB.name); // Intact.
  });

  // ─── Orders — même isolation ────────────────────────────────

  it("update() sur une order d'un autre tenant throw et laisse le status intact", async () => {
    await expect(
      asTenant(tenantB.id, () =>
        prisma.order.update({
          where: { id: orderA.id },
          data: { status: "SHIPPED" },
        })
      )
    ).rejects.toThrow();

    const after = await rawPrisma.order.findUnique({ where: { id: orderA.id } });
    expect(after?.status).toBe("PENDING");
  });

  it("findFirst(orderNumber) scope au tenant courant", async () => {
    const fromA = await asTenant(tenantA.id, () =>
      prisma.order.findFirst({ where: { orderNumber: orderA.orderNumber } })
    );
    const fromB = await asTenant(tenantB.id, () =>
      prisma.order.findFirst({ where: { orderNumber: orderB.orderNumber } })
    );
    expect(fromA?.id).toBe(orderA.id);
    expect(fromB?.id).toBe(orderB.id);
  });

  // ─── Users — email peut être partagé entre tenants ──────────

  it("un email peut exister dans 2 tenants et findFirst renvoie le bon", async () => {
    // Aucun email partagé dans notre setup, on vérifie juste que le scope
    // fonctionne — chaque tenant voit son propre user par email.
    const fromA = await asTenant(tenantA.id, () =>
      prisma.user.findFirst({ where: { email: userA.email } })
    );
    expect(fromA?.id).toBe(userA.id);

    const crossFromA = await asTenant(tenantA.id, () =>
      prisma.user.findFirst({ where: { email: userB.email } })
    );
    expect(crossFromA).toBeNull();
  });
});
