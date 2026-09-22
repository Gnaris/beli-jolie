/**
 * Garde-fous sur la lecture produit Ankorstore.
 *
 * L'endpoint `GET /api/me/brand/products?filters[id]=X` a été observé (2026-08-15)
 * en train d'ignorer silencieusement le filtre et de renvoyer le premier produit
 * de la liste (tri par ID desc). Sans check, la donnée d'un AUTRE produit est
 * injectée dans le plan de sync images → un produit se retrouve avec l'image
 * d'un autre chez Ankor.
 *
 * On mocke `boGet` pour simuler la réponse Ankor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ankorstore-bo/client", () => ({
  boGet: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { boGet } from "@/lib/ankorstore-bo/client";
import {
  readProductById,
  readProductByIdWithSkuFallback,
  readProductByIdWithRetry,
  resolveAnkorImageUrl,
  searchProducts,
} from "@/lib/ankorstore-bo/read";

const mockedGet = boGet as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedGet.mockReset();
});

describe("readProductById — garde-fou ID renvoyé", () => {
  it("renvoie le produit quand l'ID correspond", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302182, name: "P32", variants: [] }],
    });
    const r = await readProductById(7302182);
    expect(r?.id).toBe(7302182);
  });

  it("renvoie null quand Ankor renvoie un produit avec un ID différent (bug filters[id])", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302183, name: "P31", variants: [] }],
    });
    const r = await readProductById(7302182);
    expect(r).toBeNull();
  });

  it("renvoie null quand data est vide", async () => {
    mockedGet.mockResolvedValueOnce({ data: [] });
    const r = await readProductById(7302182);
    expect(r).toBeNull();
  });
});

describe("readProductByIdWithSkuFallback", () => {
  it("renvoie le résultat direct si l'ID matche (pas de fallback)", async () => {
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302182, name: "P32" }],
    });
    const r = await readProductByIdWithSkuFallback(7302182, ["SKU_A"]);
    expect(r?.id).toBe(7302182);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it("fallback SKU quand filters[id] renvoie le mauvais produit", async () => {
    // 1er appel : filters[id]=7302182 → Ankor renvoie 7302183 (bug)
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302183, name: "P31" }],
    });
    // 2ᵉ appel : query=SKU_A → cherche par SKU, trouve 7302182 dans la liste
    mockedGet.mockResolvedValueOnce({
      data: [
        { id: 7302182, name: "P32" },
        { id: 7302183, name: "P31" },
      ],
    });
    const r = await readProductByIdWithSkuFallback(7302182, ["SKU_A"]);
    expect(r?.id).toBe(7302182);
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("essaie tous les SKUs jusqu'à trouver un match", async () => {
    // 1er appel direct — mauvais produit
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    // fallback SKU_A — pas de match
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    // fallback SKU_B — match
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302182, name: "P32" }],
    });
    const r = await readProductByIdWithSkuFallback(7302182, ["SKU_A", "SKU_B"]);
    expect(r?.id).toBe(7302182);
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it("renvoie null si aucun SKU ne trouve le bon produit", async () => {
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    mockedGet.mockResolvedValueOnce({ data: [{ id: 8888 }] });
    const r = await readProductByIdWithSkuFallback(7302182, ["SKU_A"]);
    expect(r).toBeNull();
  });

  it("ignore les SKU vides ou null", async () => {
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    mockedGet.mockResolvedValueOnce({
      data: [{ id: 7302182 }],
    });
    const r = await readProductByIdWithSkuFallback(7302182, ["", "  ", "SKU_A"]);
    expect(r?.id).toBe(7302182);
    // 1 direct + 1 search (les vides sont skip)
    expect(mockedGet).toHaveBeenCalledTimes(2);
  });

  it("ignore les SKU < 3 caractères (Ankor refuse la recherche)", async () => {
    // Direct : mauvais produit → déclenche le fallback
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    // Un seul search (le SKU "JG" est skip, seul "JG_ROUGE" appelle Ankor)
    mockedGet.mockResolvedValueOnce({ data: [{ id: 7302182 }] });
    const r = await readProductByIdWithSkuFallback(7302182, ["JG", "JG_ROUGE"]);
    expect(r?.id).toBe(7302182);
    expect(mockedGet).toHaveBeenCalledTimes(2); // 1 direct + 1 search (JG skip)
  });
});

describe("searchProducts — garde-fou requête < 3 caractères", () => {
  it("throw un message explicite quand la query est < 3 caractères", async () => {
    await expect(searchProducts("JG")).rejects.toThrow(
      /Ankorstore refuse toute recherche à moins de 3 caractères/,
    );
    // Ne fait AUCUN appel réseau : le garde-fou bloque en amont.
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("throw aussi sur une query vide après trim", async () => {
    await expect(searchProducts("  ab  ")).rejects.toThrow(
      /au moins 3 caractères/,
    );
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("laisse passer une query ≥ 3 caractères", async () => {
    mockedGet.mockResolvedValueOnce({ data: [{ id: 42 }] });
    const r = await searchProducts("ABC");
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(42);
  });

  it("continue si une recherche SKU throw", async () => {
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    mockedGet.mockRejectedValueOnce(new Error("network"));
    mockedGet.mockResolvedValueOnce({ data: [{ id: 7302182 }] });
    const r = await readProductByIdWithSkuFallback(7302182, ["SKU_A", "SKU_B"]);
    expect(r?.id).toBe(7302182);
  });
});

describe("resolveAnkorImageUrl", () => {
  it("renvoie null pour null/undefined/vide", () => {
    expect(resolveAnkorImageUrl(null)).toBeNull();
    expect(resolveAnkorImageUrl(undefined)).toBeNull();
    expect(resolveAnkorImageUrl("")).toBeNull();
    expect(resolveAnkorImageUrl("   ")).toBeNull();
  });

  it("conserve les URLs absolues https", () => {
    expect(
      resolveAnkorImageUrl("https://img.ankorstore.com/products/images/1-a.jpg"),
    ).toBe("https://img.ankorstore.com/products/images/1-a.jpg");
  });

  it("préfixe le CDN Ankor sur les chemins relatifs (avec ou sans slash)", () => {
    expect(resolveAnkorImageUrl("/products/images/1-a.jpg")).toBe(
      "https://img.ankorstore.com/products/images/1-a.jpg",
    );
    expect(resolveAnkorImageUrl("products/images/1-a.jpg")).toBe(
      "https://img.ankorstore.com/products/images/1-a.jpg",
    );
  });
});

describe("readProductByIdWithRetry avec skuHints", () => {
  it("utilise le fallback SKU quand skuHints est fourni", async () => {
    // Direct: mauvais produit
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    // Fallback SKU: trouve
    mockedGet.mockResolvedValueOnce({ data: [{ id: 7302182 }] });
    const r = await readProductByIdWithRetry(7302182, {
      skuHints: ["SKU_A"],
      attempts: 1,
    });
    expect(r?.id).toBe(7302182);
  });

  it("sans skuHints, comportement historique (pas de search fallback)", async () => {
    mockedGet.mockResolvedValueOnce({ data: [{ id: 9999 }] });
    const r = await readProductByIdWithRetry(7302182, {
      attempts: 1,
    });
    expect(r).toBeNull();
    expect(mockedGet).toHaveBeenCalledTimes(1); // pas de search
  });

  it("retry si null puis succès", async () => {
    mockedGet.mockResolvedValueOnce({ data: [] });
    mockedGet.mockResolvedValueOnce({ data: [{ id: 7302182 }] });
    const r = await readProductByIdWithRetry(7302182, {
      attempts: 2,
      delayMs: 1,
    });
    expect(r?.id).toBe(7302182);
  });
});
