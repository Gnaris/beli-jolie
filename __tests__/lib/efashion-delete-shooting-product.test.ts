/**
 * Anti-régression PC6 (2026-09-17).
 *
 * L'ancienne implémentation de `efashionDeleteShootingProduct` appelait
 * `POST /shootings/product/{id}/delete` — cette route REST répond « 200 OK »
 * sans rien supprimer sur les produits déjà publiés. Confirmé par le HAR de
 * suppression manuelle envoyé par la cliente : leur propre back-office
 * utilise la mutation GraphQL `softDeleteProduits(ids: [Int!]!)`.
 *
 * On vérifie ici que `efashionDeleteShootingProduct(idProduit)` :
 *   1. appelle bien `efashionSoftDeleteProduits([idProduit])` — batch d'un ID
 *   2. mappe `true` → `{ success: true }`
 *   3. mappe `false` → `{ success: false, message: ... }` (au lieu de
 *      renvoyer silencieusement un succès comme avant le fix)
 *   4. attrape les erreurs réseau et les remonte sur `message`
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { efashionSoftDeleteProduitsSpy } = vi.hoisted(() => ({
  efashionSoftDeleteProduitsSpy: vi.fn(),
}));

vi.mock("@/lib/efashion-api-write", () => ({
  efashionSoftDeleteProduits: efashionSoftDeleteProduitsSpy,
}));
vi.mock("@/lib/efashion-auth", () => ({
  ensureEfashionSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/efashion-client", () => ({
  efashionFetch: vi.fn(),
}));

import { efashionDeleteShootingProduct } from "@/lib/efashion-shootings";

beforeEach(() => {
  efashionSoftDeleteProduitsSpy.mockReset();
});

describe("efashionDeleteShootingProduct", () => {
  it("délègue à la mutation GraphQL softDeleteProduits avec l'ID en batch", async () => {
    efashionSoftDeleteProduitsSpy.mockResolvedValue(true);

    const res = await efashionDeleteShootingProduct(2423855);

    expect(efashionSoftDeleteProduitsSpy).toHaveBeenCalledOnce();
    expect(efashionSoftDeleteProduitsSpy).toHaveBeenCalledWith([2423855]);
    expect(res).toEqual({ success: true });
  });

  it("softDeleteProduits=false → success:false avec un message explicite", async () => {
    efashionSoftDeleteProduitsSpy.mockResolvedValue(false);

    const res = await efashionDeleteShootingProduct(999);

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/softDeleteProduits/);
  });

  it("erreur réseau/GraphQL → success:false avec le message d'erreur", async () => {
    efashionSoftDeleteProduitsSpy.mockRejectedValue(new Error("HTTP 500: down"));

    const res = await efashionDeleteShootingProduct(42);

    expect(res).toEqual({
      success: false,
      message: "HTTP 500: down",
    });
  });
});
