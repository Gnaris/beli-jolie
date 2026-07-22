/**
 * Vérifie que le filtre période "custom" transmet bien `customFrom` / `customTo`
 * jusqu'à la clause `where.createdAtPfs` avec les bornes gte/lte correctement
 * calculées (début de journée pour "du", fin de journée pour "au").
 *
 * Cas couverts :
 *   - custom avec les deux dates → gte + lte
 *   - custom avec juste "du"     → gte seul
 *   - custom avec juste "au"     → lte seul
 *   - custom inversé (au < du)   → le "au" est ignoré (gte seul)
 *   - period non-custom          → customFrom/customTo ignorés
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  pfsOrder: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({ id: "tenant-1", slug: "bj" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/pfs-orders-import-state", () => ({
  getPfsImportState: vi.fn(),
  startPfsHistoricalImportInBackground: vi.fn(),
  requestStopPfsHistoricalImport: vi.fn(),
  resetPfsImportState: vi.fn(),
}));
vi.mock("@/lib/pfs-orders-sync", () => ({
  syncRecentPfsOrders: vi.fn(),
  syncSinglePfsOrder: vi.fn(),
}));
vi.mock("@/lib/image-utils", () => ({ getImageSrc: (p: string) => p }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { listPfsOrders } from "@/app/actions/admin/pfs-orders";

beforeEach(() => {
  vi.clearAllMocks();
});

function lastFindManyWhere() {
  const call = mockPrisma.pfsOrder.findMany.mock.calls.at(-1)?.[0] as
    | { where?: Record<string, unknown> }
    | undefined;
  return call?.where ?? {};
}

describe("listPfsOrders — période personnalisée", () => {
  it("gte + lte quand les deux dates sont fournies", async () => {
    await listPfsOrders({
      period: "custom",
      customFrom: "2026-06-01",
      customTo: "2026-06-30",
    });
    const where = lastFindManyWhere();
    const range = where.createdAtPfs as { gte?: Date; lte?: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeInstanceOf(Date);
    expect(range.gte?.getHours()).toBe(0);
    expect(range.gte?.getMinutes()).toBe(0);
    // Fin de journée : inclut toute la journée du 30
    expect(range.lte?.getHours()).toBe(23);
    expect(range.lte?.getMinutes()).toBe(59);
    expect(range.lte?.getFullYear()).toBe(2026);
    expect(range.lte?.getMonth()).toBe(5); // juin (0-indexed)
    expect(range.lte?.getDate()).toBe(30);
  });

  it("gte seul quand seule la date de début est fournie", async () => {
    await listPfsOrders({
      period: "custom",
      customFrom: "2026-06-01",
      customTo: "",
    });
    const range = lastFindManyWhere().createdAtPfs as { gte?: Date; lte?: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeUndefined();
  });

  it("lte seul quand seule la date de fin est fournie", async () => {
    await listPfsOrders({
      period: "custom",
      customFrom: "",
      customTo: "2026-06-30",
    });
    const range = lastFindManyWhere().createdAtPfs as { gte?: Date; lte?: Date };
    expect(range.gte).toBeUndefined();
    expect(range.lte).toBeInstanceOf(Date);
    expect(range.lte?.getHours()).toBe(23);
  });

  it("ignore le \"au\" si antérieur au \"du\" (plage inversée)", async () => {
    await listPfsOrders({
      period: "custom",
      customFrom: "2026-06-30",
      customTo: "2026-06-01",
    });
    const range = lastFindManyWhere().createdAtPfs as { gte?: Date; lte?: Date };
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.lte).toBeUndefined();
  });

  it("aucun filtre createdAtPfs quand custom sans aucune date", async () => {
    await listPfsOrders({ period: "custom", customFrom: "", customTo: "" });
    expect(lastFindManyWhere().createdAtPfs).toBeUndefined();
  });

  it("ignore customFrom/customTo quand période n'est pas custom", async () => {
    await listPfsOrders({
      period: "today",
      customFrom: "2020-01-01",
      customTo: "2020-01-02",
    });
    const range = lastFindManyWhere().createdAtPfs as { gte?: Date; lte?: Date };
    // "today" impose un gte = début de journée courante, jamais 2020.
    expect(range.gte).toBeInstanceOf(Date);
    expect(range.gte?.getFullYear()).toBeGreaterThan(2020);
    expect(range.lte).toBeUndefined();
  });

  it("format YYYY-MM-DD invalide → date ignorée", async () => {
    await listPfsOrders({
      period: "custom",
      customFrom: "01/06/2026",
      customTo: "not-a-date",
    });
    expect(lastFindManyWhere().createdAtPfs).toBeUndefined();
  });
});
