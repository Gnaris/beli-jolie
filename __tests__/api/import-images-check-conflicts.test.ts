import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: vi.fn() },
    productColorImage: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/admin/products/import/images/check-conflicts/route";

function makeReq(body: unknown): Request {
  return new Request("http://x/api/admin/products/import/images/check-conflicts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { role: "ADMIN" },
  });
});

describe("POST /api/admin/products/import/images/check-conflicts", () => {
  it("détecte un conflit même quand l'image existante a productColorId=NULL (cas A2098)", async () => {
    // Produit A2098 avec une variante Vert. La variante n'a AUCUNE image liée
    // via `productColorId`. En base réelle, l'image existante est reliée au
    // produit + à la couleur uniquement (`productColorId=NULL`). C'est le
    // cas typique qui faisait passer les fichiers en « Prêt à importer »
    // alors qu'ils écrasaient une image existante.
    (prisma.product.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prd_A2098",
        reference: "A2098",
        name: "Collier",
        colors: [
          {
            id: "pc_vert_unit",
            colorId: "col_vert",
            color: { name: "Vert", hex: "#0f0", patternImage: null },
          },
        ],
      },
    ]);
    (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        productId: "prd_A2098",
        colorId: "col_vert",
        productColorId: null, // ← le cas qui n'était pas détecté avant
        order: 0,
        path: "uploads/beliandjolie/produits/a2098/a2098-vert-1.webp",
      },
    ]);

    const res = await POST(
      makeReq({
        files: [
          { filename: "A2098 Vert 1.JPG", reference: "A2098", color: "Vert", position: 1 },
        ],
      }),
    );
    const json = await res.json();

    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0]).toMatchObject({
      filename: "A2098 Vert 1.JPG",
      reference: "A2098",
      color: "Vert",
      position: 1,
      existingImagePath: "uploads/beliandjolie/produits/a2098/a2098-vert-1.webp",
    });
    expect(json.conflicts[0].availablePositions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(json.missingColors).toEqual([]);
    expect(json.missingRefs).toEqual([]);
  });

  it("ne signale rien si la position ciblée est libre", async () => {
    (prisma.product.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prd_A2098",
        reference: "A2098",
        name: "Collier",
        colors: [
          {
            id: "pc_vert",
            colorId: "col_vert",
            color: { name: "Vert", hex: "#0f0", patternImage: null },
          },
        ],
      },
    ]);
    (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { productId: "prd_A2098", colorId: "col_vert", productColorId: null, order: 0, path: "x.webp" },
    ]);

    const res = await POST(
      makeReq({
        files: [
          { filename: "A2098 Vert 2.JPG", reference: "A2098", color: "Vert", position: 2 },
        ],
      }),
    );
    const json = await res.json();

    expect(json.conflicts).toEqual([]);
    expect(json.missingColors).toEqual([]);
    expect(json.missingRefs).toEqual([]);
  });

  it("signale une couleur manquante si la couleur du fichier n'existe pas sur le produit", async () => {
    (prisma.product.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prd_A2098",
        reference: "A2098",
        name: "Collier",
        colors: [
          {
            id: "pc_bleu",
            colorId: "col_bleu",
            color: { name: "Bleu", hex: "#00f", patternImage: null },
          },
        ],
      },
    ]);
    (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await POST(
      makeReq({
        files: [
          { filename: "A2098 Rose 1.JPG", reference: "A2098", color: "Rose", position: 1 },
        ],
      }),
    );
    const json = await res.json();

    expect(json.conflicts).toEqual([]);
    expect(json.missingColors).toHaveLength(1);
    expect(json.missingColors[0]).toMatchObject({ color: "Rose" });
  });

  it("signale une référence inexistante", async () => {
    (prisma.product.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const res = await POST(
      makeReq({
        files: [
          { filename: "ZZZZ Vert 1.JPG", reference: "ZZZZ", color: "Vert", position: 1 },
        ],
      }),
    );
    const json = await res.json();

    expect(json.missingRefs).toHaveLength(1);
    expect(json.missingRefs[0].reference).toBe("ZZZZ");
  });

  it("agrège les images UNIT + PACK sur la même couleur (contrainte unique (productId, colorId, order))", async () => {
    // Une variante UNIT n'a pas d'image en position 1, mais une variante PACK
    // en a une. La collision doit remonter parce que la contrainte porte sur
    // (productId, colorId, order).
    (prisma.product.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "prd_A2098",
        reference: "A2098",
        name: "Collier",
        colors: [
          {
            id: "pc_vert_unit",
            colorId: "col_vert",
            color: { name: "Vert", hex: "#0f0", patternImage: null },
          },
          {
            id: "pc_vert_pack",
            colorId: "col_vert",
            color: { name: "Vert", hex: "#0f0", patternImage: null },
          },
        ],
      },
    ]);
    (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        productId: "prd_A2098",
        colorId: "col_vert",
        productColorId: "pc_vert_pack",
        order: 0,
        path: "pack.webp",
      },
    ]);

    const res = await POST(
      makeReq({
        files: [
          { filename: "A2098 Vert 1.JPG", reference: "A2098", color: "Vert", position: 1 },
        ],
      }),
    );
    const json = await res.json();

    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0].existingImagePath).toBe("pack.webp");
  });

  it("renvoie 401 si non admin", async () => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { role: "CLIENT" },
    });
    const res = await POST(makeReq({ files: [] }));
    expect(res.status).toBe(401);
  });
});
