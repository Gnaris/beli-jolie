/**
 * Régression bug notification chat (2026-09-24) : quand une server action
 * envoyait un message, l'extension Prisma lisait `x-tenant-id` depuis les
 * headers pour scoper la requête, mais ne posait PAS l'id dans l'AsyncLocalStorage.
 * Résultat : `emitChatEvent` (appelé sync ensuite) faisait `getCurrentTenantIdSync()`
 * qui renvoyait `null` → l'event partait sans tenantId → le filtre SSE ne pouvait
 * pas rejeter le message d'un autre tenant → le son de notification sonnait sur
 * les 2 boutiques.
 *
 * Le fix : le fallback headers de `getTenantIdFromRequest` populate maintenant
 * l'ALS via `bindTenantId(id)`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const headersMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

import { getCurrentTenantIdSync, tenantALS } from "@/lib/tenant-als";
import { __getTenantIdFromRequestForTest } from "@/lib/prisma-tenant-scope";

describe("prisma-tenant-scope / fallback headers → ALS", () => {
  beforeEach(() => {
    headersMock.mockReset();
  });

  it("populate l'ALS quand le tenantId vient des headers", async () => {
    headersMock.mockResolvedValueOnce({
      get: (name: string) => (name === "x-tenant-id" ? "beliandjolie" : null),
    });

    await tenantALS.run(undefined as unknown as string, async () => {
      // ALS vide au départ (contexte fresh, comme une request qui n'a pas encore
      // appelé getCurrentTenantId).
      const id = await __getTenantIdFromRequestForTest();
      expect(id).toBe("beliandjolie");
      // Après l'appel, l'ALS DOIT être populée pour que emitChatEvent sync
      // suivant récupère le tenantId.
      expect(getCurrentTenantIdSync()).toBe("beliandjolie");
    });
  });

  it("ne surcharge pas une ALS déjà populée (priorité ALS > headers)", async () => {
    headersMock.mockResolvedValueOnce({
      get: () => "beliandjolie",
    });

    await tenantALS.run("issyma", async () => {
      const id = await __getTenantIdFromRequestForTest();
      expect(id).toBe("issyma");
      expect(headersMock).not.toHaveBeenCalled();
    });
  });

  it("renvoie null si aucune source ne donne d'id", async () => {
    headersMock.mockResolvedValueOnce({
      get: () => null,
    });

    await tenantALS.run(undefined as unknown as string, async () => {
      const id = await __getTenantIdFromRequestForTest();
      expect(id).toBeNull();
    });
  });
});
