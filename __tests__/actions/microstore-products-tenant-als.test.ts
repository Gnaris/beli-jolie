/**
 * Régression multi-tenant + robustesse photos :
 *
 *  - `pushProductToMicrostore` (unitaire) appelle l'envoi photos SYNCHRONE via
 *    le core (`sendProductPhotosToMicrostoreCore`). Historiquement en
 *    fire-and-forget, passé synchrone le 2026-08-25 car les fire-and-forget
 *    Server Actions Next 16 étaient coupés par le runtime (aucun log, widget
 *    vide). L'appel synchrone garantit exécution + remontée d'erreur.
 *
 *  - `bulkPushProductsToMicrostore` (bulk) reste en fire-and-forget wrappé
 *    `tenantALS.run(...)` pour ne pas bloquer le retour du bulk. Sans ce
 *    wrapper, les `MicrostoreUploadJob` créés seraient sans `tenantId` et
 *    invisibles dans le widget.
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
// Le preflight (Gestion Produits + token QR + Station de transfert) est
// contourné dans ce test : on vérifie ici le wrapper tenantALS, pas le garde.
vi.mock("@/lib/microstore-preflight", () => ({
  assertMicrostorePushAllowed: vi.fn().mockResolvedValue({ ok: true }),
}));
// checkProductComplete lit productColorImage.groupBy — hors scope de ce test,
// on force l'éligibilité pour aller jusqu'à l'appel photos.
vi.mock("@/lib/product-publishability-check", () => ({
  checkProductComplete: vi.fn().mockResolvedValue({ eligible: true, reasons: [], message: "" }),
}));
// La Station de Transfert n'est pas configurée → la callback wrappée par
// tenantALS.run s'arrête tôt, mais on n'a besoin que du fait que .run() a été
// invoqué avec le bon tenantId — c'est le seul invariant qui répare le bug.
vi.mock("@/lib/microstore-picture-station", () => ({
  getStoredPictureStation: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/microstore-photos-sync", () => ({
  sendProductPhotosToMicrostoreCore: vi.fn().mockResolvedValue({ success: true }),
  bulkSendPhotosToMicrostoreCore: vi.fn().mockResolvedValue({ success: true }),
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

describe("pushProductToMicrostore — appel photos synchrone (pas de fire-and-forget)", () => {
  it("appelle sendProductPhotosToMicrostoreCore de façon synchrone après le push produit", async () => {
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
    const { sendProductPhotosToMicrostoreCore } = await import(
      "@/lib/microstore-photos-sync"
    );
    const { getStoredPictureStation } = await import(
      "@/lib/microstore-picture-station"
    );
    (getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });

    const res = await pushProductToMicrostore("p1");
    expect(res.success).toBe(true);

    // Synchrone : l'appel a déjà eu lieu au moment où pushProductToMicrostore
    // rend la main. Pas besoin d'attendre une microtask.
    expect(sendProductPhotosToMicrostoreCore).toHaveBeenCalledWith("REF-1");
  });

  it("renvoie succès + warning si le push photos échoue (fiche produit OK malgré tout)", async () => {
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
    const { sendProductPhotosToMicrostoreCore } = await import(
      "@/lib/microstore-photos-sync"
    );
    // La Station de transfert doit être configurée pour que le core soit appelé.
    const { getStoredPictureStation } = await import(
      "@/lib/microstore-picture-station"
    );
    (getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });
    (sendProductPhotosToMicrostoreCore as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: "Aucune couleur Microstore équivalente.",
    });

    const res = await pushProductToMicrostore("p1");
    expect(res.success).toBe(true);
    expect(res.error).toMatch(/photos non uploadées.*couleur/i);
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
