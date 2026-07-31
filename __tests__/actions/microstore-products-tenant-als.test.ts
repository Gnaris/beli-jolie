/**
 * Régression multi-tenant : les server actions `pushProductToMicrostore` et
 * `bulkPushProductsToMicrostore` chaînent l'envoi des photos vers Microstore
 * en fire-and-forget (IIFE lancée sans await). Sans wrapper `tenantALS.run(...)`
 * autour de cette IIFE, les jobs `MicrostoreUploadJob` créés par le pipeline
 * photos sont insérés SANS `tenantId` — le widget « Photos Microstore » scope
 * par tenant, donc reste vide malgré des uploads bien réels côté serveur.
 *
 * Bug observé le 2026-07-31 : la cliente lance « Synchroniser vers Microstore »
 * sur plusieurs produits, l'export Excel part, les photos s'uploadent, mais
 * le widget cyan ne bouge jamais.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const runSpy = vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi
    .fn()
    .mockResolvedValue({ id: "tenant-beliandjolie-xyz", slug: "beliandjolie" }),
}));
vi.mock("@/lib/tenant-als", () => ({
  tenantALS: { run: (id: string, fn: () => Promise<unknown>) => runSpy(id, fn) },
}));
vi.mock("@/lib/marketplace-excel/load-products", () => ({
  loadExportContext: vi.fn().mockResolvedValue({}),
  loadExportProducts: vi.fn(),
}));
vi.mock("@/lib/microstore-products", () => ({
  microstoreImportProducts: vi.fn().mockResolvedValue({
    success: true,
    rowsSent: 1,
    productsSent: 1,
  }),
}));
vi.mock("@/lib/microstore-client", () => ({
  MicrostoreSessionExpiredError: class extends Error {},
}));
// La Station de Transfert n'est pas configurée → la callback wrappée par
// tenantALS.run s'arrête tôt, mais on n'a besoin que du fait que .run() a été
// invoqué avec le bon tenantId — c'est le seul invariant qui répare le bug.
vi.mock("@/lib/microstore-picture-station", () => ({
  getStoredPictureStation: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/app/actions/admin/microstore-picture-station", () => ({
  sendProductPhotosToMicrostore: vi.fn().mockResolvedValue({ success: true }),
  bulkSendPhotosToMicrostore: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from "@/lib/prisma";
import { loadExportProducts } from "@/lib/marketplace-excel/load-products";
import {
  pushProductToMicrostore,
  bulkPushProductsToMicrostore,
} from "@/app/actions/admin/microstore-products";

beforeEach(() => {
  runSpy.mockClear();
  (loadExportProducts as ReturnType<typeof vi.fn>).mockReset();
  (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockReset();
  (prisma.product.findMany as ReturnType<typeof vi.fn>).mockReset();
  (prisma.product.updateMany as ReturnType<typeof vi.fn>).mockReset();
  (prisma.product.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
});

describe("pushProductToMicrostore — wrapper tenantALS autour du fire-and-forget photos", () => {
  it("appelle tenantALS.run avec le tenantId courant avant de chaîner l'envoi photos", async () => {
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      reference: "REF-1",
      microstoreEnabled: true,
      countryIsoCode: "FR",
    });
    (loadExportProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        reference: "REF-1",
        variants: [{ saleType: "UNIT", colorNames: ["Or"] }],
      },
    ]);

    const res = await pushProductToMicrostore("p1");
    expect(res.success).toBe(true);

    // Attend la microtask du fire-and-forget (void tenantALS.run(...))
    await new Promise((r) => setImmediate(r));

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0]?.[0]).toBe("tenant-beliandjolie-xyz");
  });
});

describe("bulkPushProductsToMicrostore — wrapper tenantALS autour du fire-and-forget bulk photos", () => {
  it("appelle tenantALS.run avec le tenantId courant avant de chaîner le bulk photos", async () => {
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        reference: "REF-1",
        microstoreEnabled: true,
        countryIsoCode: "FR",
      },
      {
        id: "p2",
        reference: "REF-2",
        microstoreEnabled: true,
        countryIsoCode: "FR",
      },
    ]);
    (loadExportProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        reference: "REF-1",
        variants: [{ saleType: "UNIT", colorNames: ["Or"] }],
      },
      {
        id: "p2",
        reference: "REF-2",
        variants: [{ saleType: "UNIT", colorNames: ["Argent"] }],
      },
    ]);

    const res = await bulkPushProductsToMicrostore(["p1", "p2"]);
    expect(res.success).toBe(true);

    await new Promise((r) => setImmediate(r));

    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0]?.[0]).toBe("tenant-beliandjolie-xyz");
  });

  it("ne wrappe rien si aucun produit n'a été poussé (rien à envoyer côté photos)", async () => {
    (prisma.product.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        reference: "REF-1",
        microstoreEnabled: true,
        countryIsoCode: "FR",
      },
    ]);
    // Aucune variante UNIT → pushedIds vide → pas de fire-and-forget photos.
    (loadExportProducts as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        reference: "REF-1",
        variants: [{ saleType: "PACK", colorNames: [] }],
      },
    ]);

    await bulkPushProductsToMicrostore(["p1"]);
    await new Promise((r) => setImmediate(r));

    expect(runSpy).not.toHaveBeenCalled();
  });
});
