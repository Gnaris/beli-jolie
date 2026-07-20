/**
 * Régression multi-tenant : le webhook Ankorstore reçoit tous les callbacks
 * sur le host principal (`beliandjolie.com`) — le middleware pose alors
 * `x-tenant-id = beliandjolie` — mais l'opération peut appartenir à Issyma.
 * Le helper doit résoudre le vrai tenantId via une lecture RAW (hors scoping)
 * puis wrapper le callback dans un `tenantALS.run` pour que les queries en
 * aval trouvent la row et écrivent dans la bonne boutique.
 *
 * Sans ce helper, le bug observé le 2026-07-20 : op Issyma restait PENDING
 * malgré un callback `succeeded`, boutons "en cours" à l'infini côté UI.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const queryRawMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

import {
  findAnkorstoreOperationTenantId,
  resolveAnkorstoreOperationTenantId,
  runInAnkorstoreOperationTenant,
} from "@/lib/ankorstore-webhook-tenant";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

beforeEach(() => {
  queryRawMock.mockReset();
});

describe("findAnkorstoreOperationTenantId", () => {
  it("retourne le tenantId brut de l'op (hors scoping)", async () => {
    queryRawMock.mockResolvedValueOnce([{ tenantId: "issy0e8e276b" }]);
    const result = await findAnkorstoreOperationTenantId("op-1");
    expect(result).toBe("issy0e8e276b");
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("retourne null si l'op est absente", async () => {
    queryRawMock.mockResolvedValueOnce([]);
    const result = await findAnkorstoreOperationTenantId("op-inconnue");
    expect(result).toBeNull();
  });

  it("retourne null si l'op existe mais son tenantId est NULL (row legacy)", async () => {
    queryRawMock.mockResolvedValueOnce([{ tenantId: null }]);
    const result = await findAnkorstoreOperationTenantId("op-legacy");
    expect(result).toBeNull();
  });
});

describe("resolveAnkorstoreOperationTenantId (retry logic)", () => {
  it("succès immédiat sans retry", async () => {
    queryRawMock.mockResolvedValueOnce([{ tenantId: "bj-tenant" }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await resolveAnkorstoreOperationTenantId("op-1", sleep);
    expect(result).toBe("bj-tenant");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("2 retries si la row n'existe pas encore (race callback avant persist)", async () => {
    queryRawMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tenantId: "issy-tenant" }]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await resolveAnkorstoreOperationTenantId("op-race", sleep);
    expect(result).toBe("issy-tenant");
    // 1er attempt fait sleep(1500), 2ème sleep(3000)
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1500);
    expect(sleep).toHaveBeenNthCalledWith(2, 3000);
  });

  it("retourne null après épuisement des retries", async () => {
    queryRawMock.mockResolvedValue([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await resolveAnkorstoreOperationTenantId("op-fantome", sleep);
    expect(result).toBeNull();
    expect(queryRawMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("runInAnkorstoreOperationTenant", () => {
  it("expose le tenantId passé au callback via getCurrentTenantIdSync()", async () => {
    let observed: string | null = null;
    await runInAnkorstoreOperationTenant("issy-tenant-xyz", async () => {
      observed = getCurrentTenantIdSync();
    });
    expect(observed).toBe("issy-tenant-xyz");
  });

  it("override un tenant déjà posé dans l'ALS (celui du Host)", async () => {
    // Simule le middleware qui a posé BJ dans l'ALS pour ce request
    const { tenantALS } = await import("@/lib/tenant-als");
    let observed: string | null = null;
    await tenantALS.run("beliandjolie-tenant", async () => {
      // Le helper doit surcharger avec le tenant de l'op
      await runInAnkorstoreOperationTenant("issyma-tenant", async () => {
        observed = getCurrentTenantIdSync();
      });
    });
    expect(observed).toBe("issyma-tenant");
  });

  it("propage la valeur de retour du callback", async () => {
    const result = await runInAnkorstoreOperationTenant("t1", async () => 42);
    expect(result).toBe(42);
  });

  it("propage les exceptions du callback", async () => {
    await expect(
      runInAnkorstoreOperationTenant("t1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
