import { describe, it, expect, vi } from "vitest";
import { bumpProductsUpdatedAt } from "@/lib/import-processor";

/**
 * Le tri admin « Modifié récemment d'abord » s'appuie sur `Product.updatedAt`.
 * Quand l'import en masse d'images n'écrit que des `ProductColorImage`, le
 * timestamp du produit ne bouge pas tout seul — il faut le pousser à la main.
 * Ce test vérifie que le helper appelle bien `updateMany` avec les bons IDs
 * et un `updatedAt` frais, et qu'il ne fait rien sur tableau vide.
 */

function makeFakeClient() {
  const updateMany = vi.fn(async () => ({ count: 0 }));
  return {
    client: { product: { updateMany } },
    updateMany,
  };
}

describe("bumpProductsUpdatedAt", () => {
  it("bumpe `updatedAt` pour tous les IDs fournis", async () => {
    const { client, updateMany } = makeFakeClient();
    const before = Date.now();
    await bumpProductsUpdatedAt(client, ["p1", "p2", "p3"]);
    const after = Date.now();

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["p1", "p2", "p3"] } });
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
    const ts = arg.data.updatedAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("ne touche pas la BDD si la liste est vide", async () => {
    const { client, updateMany } = makeFakeClient();
    await bumpProductsUpdatedAt(client, []);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
