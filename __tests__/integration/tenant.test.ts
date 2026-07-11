/**
 * Integration tests: Tenant + TenantDomain + relations vers User/Product/Order/CompanyInfo.
 *
 * Ces tests figent le comportement de la phase 1 du chantier multi-tenant :
 *   1. Un Tenant peut être créé avec un slug unique.
 *   2. Un TenantDomain peut mapper plusieurs hosts vers un même Tenant.
 *   3. Le host est unique globalement (deux tenants ne peuvent pas revendiquer le même domaine).
 *   4. Les modèles User, Product, Order, CompanyInfo portent bien une clé étrangère nullable vers Tenant.
 *   5. Le tenant par défaut « beli-jolie » (créé par scripts/seed-default-tenant.ts) est présent
 *      et rattaché à toutes les données existantes (aucun orphelin).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

const DEFAULT_TENANT_SLUG = "beli-jolie";

describe("Tenant + relations (real DB)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("Tenant CRUD", () => {
    let tenantId: string;

    it("crée un tenant avec slug unique", async () => {
      const tenant = await prisma.tenant.create({
        data: {
          slug: `${TEST_PREFIX.toLowerCase()}shop-a`,
          name: `${TEST_PREFIX}Boutique A`,
        },
      });
      tenantId = tenant.id;

      expect(tenant.slug).toBe(`${TEST_PREFIX.toLowerCase()}shop-a`);
      expect(tenant.isActive).toBe(true);
    });

    it("refuse un slug en doublon", async () => {
      await expect(
        prisma.tenant.create({
          data: {
            slug: `${TEST_PREFIX.toLowerCase()}shop-a`,
            name: `${TEST_PREFIX}Boutique A bis`,
          },
        }),
      ).rejects.toThrow();
    });

    it("attache plusieurs domaines à un même tenant", async () => {
      await prisma.tenantDomain.createMany({
        data: [
          { tenantId, host: `${TEST_PREFIX.toLowerCase()}shop-a.test`, isPrimary: true },
          { tenantId, host: `www.${TEST_PREFIX.toLowerCase()}shop-a.test`, isPrimary: false },
        ],
      });

      const domains = await prisma.tenantDomain.findMany({ where: { tenantId } });
      expect(domains).toHaveLength(2);
      expect(domains.some((d) => d.isPrimary)).toBe(true);
    });

    it("refuse un host en doublon même sur un autre tenant", async () => {
      const otherTenant = await prisma.tenant.create({
        data: {
          slug: `${TEST_PREFIX.toLowerCase()}shop-b`,
          name: `${TEST_PREFIX}Boutique B`,
        },
      });

      await expect(
        prisma.tenantDomain.create({
          data: {
            tenantId: otherTenant.id,
            host: `${TEST_PREFIX.toLowerCase()}shop-a.test`,
          },
        }),
      ).rejects.toThrow();
    });

    it("cascade la suppression des domaines quand on supprime le tenant", async () => {
      const doomed = await prisma.tenant.create({
        data: {
          slug: `${TEST_PREFIX.toLowerCase()}shop-doomed`,
          name: `${TEST_PREFIX}Doomed`,
        },
      });
      await prisma.tenantDomain.create({
        data: { tenantId: doomed.id, host: `${TEST_PREFIX.toLowerCase()}doomed.test` },
      });

      await prisma.tenant.delete({ where: { id: doomed.id } });

      const orphan = await prisma.tenantDomain.findUnique({
        where: { host: `${TEST_PREFIX.toLowerCase()}doomed.test` },
      });
      expect(orphan).toBeNull();
    });
  });

  describe("Tenant par défaut « beli-jolie »", () => {
    it("existe et a au moins un domaine primaire", async () => {
      const tenant = await prisma.tenant.findUnique({
        where: { slug: DEFAULT_TENANT_SLUG },
        include: { domains: true },
      });

      expect(tenant, "tenant beli-jolie manquant — lance scripts/seed-default-tenant.ts").not.toBeNull();
      expect(tenant!.domains.length).toBeGreaterThan(0);
      expect(tenant!.domains.some((d) => d.isPrimary)).toBe(true);
    });

    it("n'a laissé aucun user/product/order/companyInfo orphelin après backfill", async () => {
      const [orphanUsers, orphanProducts, orphanOrders, orphanCompanyInfos] = await Promise.all([
        prisma.user.count({ where: { tenantId: null } }),
        prisma.product.count({ where: { tenantId: null } }),
        prisma.order.count({ where: { tenantId: null } }),
        prisma.companyInfo.count({ where: { tenantId: null } }),
      ]);

      expect(orphanUsers, "des users sans tenant — relance scripts/backfill-tenant-id.ts").toBe(0);
      expect(orphanProducts, "des products sans tenant — relance scripts/backfill-tenant-id.ts").toBe(0);
      expect(orphanOrders, "des orders sans tenant — relance scripts/backfill-tenant-id.ts").toBe(0);
      expect(orphanCompanyInfos, "des companyInfos sans tenant — relance scripts/backfill-tenant-id.ts").toBe(0);
    });
  });
});
