/**
 * Integration test setup.
 *
 * Uses REAL Prisma DB for data operations.
 * Mocks: NextAuth, Next.js cache, auto-translate, PFS sync, storage, SSE events.
 *
 * All test data is prefixed with "TEST_" and cleaned up after each suite.
 */
import { vi } from "vitest";
import { prisma } from "@/lib/prisma";

// ─── Test data prefix (for cleanup) ──────────────────────────────
export const TEST_PREFIX = "TEST_INTEG_";

// ─── Mock NextAuth (all actions use local requireAdmin()) ────────
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "test-admin-id", role: "ADMIN", status: "APPROVED", email: "admin@test.com" },
  }),
}));

// ─── Mock Next.js cache/navigation ───────────────────────────────
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// ─── Mock auto-translate (avoid external API calls) ──────────────
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
  autoTranslateCategory: vi.fn(),
  autoTranslateSubCategory: vi.fn(),
  autoTranslateComposition: vi.fn(),
  autoTranslateColor: vi.fn(),
  autoTranslateSeason: vi.fn(),
  autoTranslateCollection: vi.fn(),
}));

// ─── Mock PFS sync (avoid calling real PFS) ──────────────────────
vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateStatus: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock notifications (avoid sending real emails) ──────────────
vi.mock("@/lib/notifications", () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock SSE product events ─────────────────────────────────────
vi.mock("@/lib/product-events", () => ({
  emitProductEvent: vi.fn(),
}));

// ─── Mock translate invalidation ─────────────────────────────────
vi.mock("@/lib/translate", () => ({
  invalidateProductTranslations: vi.fn(),
}));

// ─── Mock logger to suppress output ──────────────────────────────
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Mock tenant helpers (les server actions appellent requireCurrentTenant, ─
// impossible sans request scope Next.js). On simule le tenant beli-jolie qui
// existe déjà en BDD (créé par scripts/seed-default-tenant.ts). Le cache est
// pré-warm en top-level await ci-dessous pour que l'extension Prisma tenant-scope
// voie tout de suite un tenantId non-null dès le premier create() dans un test
// (sinon les rows créées seraient orphelines et casseraient les cleanup FK).
const DEFAULT_TENANT_SLUG = "beli-jolie";
let cachedDefaultTenant: { id: string; slug: string; name: string } | null = null;
async function loadDefaultTenant() {
  if (cachedDefaultTenant) return cachedDefaultTenant;
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient();
  try {
    const t = await raw.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
    if (!t) {
      throw new Error(
        `[test setup] Tenant ${DEFAULT_TENANT_SLUG} introuvable — lance scripts/seed-default-tenant.ts d'abord.`
      );
    }
    cachedDefaultTenant = { id: t.id, slug: t.slug, name: t.name };
    return cachedDefaultTenant;
  } finally {
    await raw.$disconnect();
  }
}

// Top-level await : bloque l'évaluation de setup.ts jusqu'à ce que le tenant
// soit résolu. Fait au premier import (partagé entre tous les fichiers via ESM cache).
await loadDefaultTenant();

vi.mock("@/lib/tenant", async () => {
  return {
    getCurrentTenantId: async () => (await loadDefaultTenant()).id,
    getCurrentTenantSlug: async () => (await loadDefaultTenant()).slug,
    getCurrentTenant: async () => loadDefaultTenant(),
    requireCurrentTenant: async () => loadDefaultTenant(),
    resolveTenantByHost: async () => loadDefaultTenant(),
  };
});

// L'extension Prisma lit d'abord `getCurrentTenantIdSync` (sync). On patche
// pour retomber sur le tenant par défaut chargé si l'ALS n'a pas été explicitement
// bindée par un test (cas des tests d'isolation cross-tenant qui utilisent
// `tenantALS.run()`). Ordre : ALS d'abord, sinon tenant beli-jolie.
vi.mock("@/lib/tenant-als", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant-als")>("@/lib/tenant-als");
  return {
    ...actual,
    getCurrentTenantIdSync: () => actual.tenantALS.getStore() ?? cachedDefaultTenant?.id ?? null,
  };
});

// ─── Cleanup helpers ─────────────────────────────────────────────

/**
 * Delete all test data created during integration tests.
 * Runs in dependency order (children first) to avoid FK violations.
 */
export async function cleanupTestData() {
  // Delete products and all their cascading relations
  const testProducts = await prisma.product.findMany({
    where: { reference: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const productIds = testProducts.map((p) => p.id);

  if (productIds.length > 0) {
    // Delete product-dependent records
    await prisma.productTag.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productComposition.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.productSimilar.deleteMany({
      where: { OR: [{ productId: { in: productIds } }, { similarId: { in: productIds } }] },
    });
    await prisma.productBundle.deleteMany({
      where: { OR: [{ parentId: { in: productIds } }, { childId: { in: productIds } }] },
    });
    await prisma.productTranslation.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.collectionProduct.deleteMany({ where: { productId: { in: productIds } } });

    // Delete variant-dependent records
    const variants = await prisma.productColor.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    const variantIds = variants.map((v) => v.id);

    if (variantIds.length > 0) {
      await prisma.variantSize.deleteMany({ where: { productColorId: { in: variantIds } } });
      await prisma.productColor.deleteMany({ where: { id: { in: variantIds } } });
    }

    await prisma.productColorImage.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }

  // Delete test entities (order matters for FK)
  await prisma.tag.deleteMany({
    where: { OR: [
      { name: { startsWith: TEST_PREFIX } },
      { name: { startsWith: TEST_PREFIX.toLowerCase() } },
    ] },
  });
  await prisma.size.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

  // SubCategories before Categories
  await prisma.subCategory.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.category.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

  await prisma.color.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.composition.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.season.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.collection.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });

  // Delete test orders
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: TEST_PREFIX } } },
  });
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TEST_PREFIX } } });

  // Delete test users
  await prisma.user.deleteMany({ where: { email: { startsWith: "test_integ_" } } });

  // Delete test tenants (children first: TenantDomain via cascade, but also explicit for clarity)
  const testTenantSlugs = await prisma.tenant.findMany({
    where: { slug: { startsWith: TEST_PREFIX.toLowerCase() } },
    select: { id: true },
  });
  const testTenantIds = testTenantSlugs.map((t) => t.id);
  if (testTenantIds.length > 0) {
    await prisma.tenantDomain.deleteMany({ where: { tenantId: { in: testTenantIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: testTenantIds } } });
  }
}

/**
 * Create seed entities needed for product tests.
 * Returns IDs for use in product creation.
 */
export async function seedTestEntities() {
  const category = await prisma.category.create({
    data: { name: `${TEST_PREFIX}Bagues`, slug: `${TEST_PREFIX}bagues`.toLowerCase() },
  });

  const color1 = await prisma.color.create({
    data: { name: `${TEST_PREFIX}Doré`, hex: "#FFD700" },
  });

  const color2 = await prisma.color.create({
    data: { name: `${TEST_PREFIX}Argenté`, hex: "#C0C0C0" },
  });

  const color3 = await prisma.color.create({
    data: { name: `${TEST_PREFIX}Rose`, hex: "#FF69B4" },
  });

  const composition = await prisma.composition.create({
    data: { name: `${TEST_PREFIX}Acier inoxydable` },
  });

  const size = await prisma.size.create({
    data: { name: `${TEST_PREFIX}TU`, position: 0 },
  });

  const sizeS = await prisma.size.create({
    data: { name: `${TEST_PREFIX}S`, position: 1 },
  });

  const sizeM = await prisma.size.create({
    data: { name: `${TEST_PREFIX}M`, position: 2 },
  });

  // Pays de fabrication : figé dans lib/countries.ts, plus de seed BDD.
  // `id` = code ISO alpha-2 pour rester compatible avec les tests qui
  // passaient `manufacturingCountryId: entities.country.id`. Ces tests
  // devront passer `countryIsoCode: entities.country.id` désormais.
  const country = { id: "CN", code: "CN", name: "Chine" } as const;

  const season = await prisma.season.create({
    data: { name: `${TEST_PREFIX}PE2026` },
  });

  return {
    category,
    color1,
    color2,
    color3,
    composition,
    size,
    sizeS,
    sizeM,
    country,
    season,
  };
}

export { prisma };
