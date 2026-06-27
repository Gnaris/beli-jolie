import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock est hissé en haut du fichier → on déclare l'usine sans variable
// externe puis on récupère le mock typé via import après.
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { updateMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { recordMarketplaceExport } from "@/lib/marketplace-export-tracking";

const updateManyMock = prisma.product.updateMany as unknown as ReturnType<typeof vi.fn>;

describe("recordMarketplaceExport", () => {
  beforeEach(() => {
    updateManyMock.mockReset();
    updateManyMock.mockResolvedValue({ count: 0 });
  });

  it("ne fait aucun appel BDD si la liste est vide", async () => {
    await recordMarketplaceExport("pfs", []);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("met à jour pfsLastExportedAt pour les ids fournis (PFS)", async () => {
    const now = new Date("2026-06-24T10:00:00Z");
    await recordMarketplaceExport("pfs", ["p1", "p2"], now);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] } },
      data: { pfsLastExportedAt: now },
    });
  });

  it("met à jour efashionLastExportedAt (eFashion)", async () => {
    const now = new Date("2026-06-24T10:00:00Z");
    await recordMarketplaceExport("efashion", ["p1"], now);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { efashionLastExportedAt: now },
    });
  });

  it("met à jour microstoreLastExportedAt (Microstore)", async () => {
    const now = new Date("2026-06-24T10:00:00Z");
    await recordMarketplaceExport("microstore", ["p1"], now);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { microstoreLastExportedAt: now },
    });
  });

  it("met à jour ankorstoreLastExportedAt (Ankorstore)", async () => {
    const now = new Date("2026-06-24T10:00:00Z");
    await recordMarketplaceExport("ankorstore", ["p1", "p2", "p3"], now);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2", "p3"] } },
      data: { ankorstoreLastExportedAt: now },
    });
  });

  it("met à jour faireLastExportedAt (Faire)", async () => {
    const now = new Date("2026-06-27T18:00:00Z");
    await recordMarketplaceExport("faire", ["p9"], now);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p9"] } },
      data: { faireLastExportedAt: now },
    });
  });

  it("utilise new Date() par défaut quand `now` n'est pas fourni", async () => {
    const before = Date.now();
    await recordMarketplaceExport("pfs", ["p1"]);
    const after = Date.now();
    const call = updateManyMock.mock.calls[0]![0];
    expect(call.data.pfsLastExportedAt).toBeInstanceOf(Date);
    const ts = call.data.pfsLastExportedAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
