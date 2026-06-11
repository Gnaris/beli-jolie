import { describe, it, expect, beforeEach } from "vitest";
import { placeImageInVariant } from "@/lib/import-processor";

// In-memory fake Prisma client : simule juste productColorImage avec les méthodes utilisées.
// IMPORTANT : la contrainte unique est sur (productId, colorId, order), donc on filtre
// par ces deux colonnes (pas par productColorId).
type Row = { id: string; order: number; productId: string; colorId: string };

function makeFakePrisma(initialRows: Row[]) {
  const rows: Row[] = [...initialRows];
  let idCounter = initialRows.length + 1;
  const ops: Array<{ kind: "delete" | "update" | "create"; payload: Record<string, unknown> }> = [];

  return {
    productColorImage: {
      findMany: async ({ where, select }: { where: { productId: string; colorId: string }; select?: Record<string, boolean> }) => {
        const filtered = rows.filter((r) => r.productId === where.productId && r.colorId === where.colorId);
        if (select?.id && select?.order) return filtered.map((r) => ({ id: r.id, order: r.order }));
        if (select?.order) return filtered.map((r) => ({ order: r.order }));
        return filtered;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx >= 0) rows.splice(idx, 1);
        ops.push({ kind: "delete", payload: { id: where.id } });
        return { id: where.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: { order: number } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) row.order = data.order;
        ops.push({ kind: "update", payload: { id: where.id, order: data.order } });
        return row;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const newRow = {
          id: `created-${idCounter++}`,
          order: data.order as number,
          productId: data.productId as string,
          colorId: data.colorId as string,
        };
        rows.push(newRow);
        ops.push({ kind: "create", payload: data });
        return newRow;
      },
    },
    _rows: rows,
    _ops: ops,
  };
}

const BASE = { productId: "p1", colorId: "c1" };

describe("placeImageInVariant", () => {
  let fake: ReturnType<typeof makeFakePrisma>;

  describe("pas de conflit", () => {
    beforeEach(() => {
      fake = makeFakePrisma([]);
    });

    it("place à la position demandée si la variant est vide", async () => {
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 3,
        positionOverridden: false,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(0);
      expect(res.appliedStrategy).toBe("none");
      expect(fake._ops).toHaveLength(0);
    });

    it("respecte l'override de position", async () => {
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 3,
        positionOverridden: true,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(2);
      expect(res.appliedStrategy).toBe("none");
    });
  });

  describe("avec conflit", () => {
    it("replace : supprime l'image existante et garde le slot", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, ...BASE },
        { id: "b", order: 1, ...BASE },
        { id: "c", order: 2, ...BASE },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 2,
        positionOverridden: false,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(1);
      expect(res.appliedStrategy).toBe("replace");
      expect(fake._rows.find((r) => r.id === "b")).toBeUndefined();
    });

    it("shift : décale en cascade pour libérer le slot", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, ...BASE },
        { id: "b", order: 1, ...BASE },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 1,
        positionOverridden: true,
        strategy: "shift",
      });
      expect(res.finalOrder).toBe(0);
      expect(res.appliedStrategy).toBe("shift");
      expect(fake._rows.find((r) => r.id === "a")?.order).toBe(1);
      expect(fake._rows.find((r) => r.id === "b")?.order).toBe(2);
    });

    it("next_available : ne touche rien, glisse vers la prochaine libre", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, ...BASE },
        { id: "b", order: 1, ...BASE },
        { id: "c", order: 2, ...BASE },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 1,
        positionOverridden: true,
        strategy: "next_available",
      });
      expect(res.finalOrder).toBe(3);
      expect(res.appliedStrategy).toBe("next_available");
      expect(fake._ops).toEqual([]);
    });
  });

  describe("portée réelle de la contrainte unique : (productId, colorId)", () => {
    it("voit le conflit entre 2 variantes UNIT et PACK qui partagent la même couleur", async () => {
      // Cas réel qui plantait avant le fix : un produit a une variante UNIT et une
      // variante PACK, toutes les deux sur la couleur Doré. Une image existe sur
      // la variante UNIT à order=1. L'import vise la variante PACK avec position 2.
      // Le placement DOIT voir que (productId, colorId) à order=1 est déjà pris,
      // même si productColorId est différent.
      fake = makeFakePrisma([
        // image existante sur productId=p1, colorId=c1, order=1
        { id: "a", order: 0, productId: "p1", colorId: "c1" },
        { id: "b", order: 1, productId: "p1", colorId: "c1" },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productId: "p1",
        colorId: "c1",
        requestedPosition: 2,
        positionOverridden: false,
        strategy: "replace",
      });
      // Doit détecter la collision et appliquer la stratégie replace
      expect(res.finalOrder).toBe(1);
      expect(res.appliedStrategy).toBe("replace");
      expect(fake._rows.find((r) => r.id === "b")).toBeUndefined();
    });

    it("ignore les images d'un autre produit ou d'une autre couleur", async () => {
      fake = makeFakePrisma([
        { id: "x", order: 0, productId: "OTHER", colorId: "c1" },
        { id: "y", order: 0, productId: "p1", colorId: "OTHER" },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productId: "p1",
        colorId: "c1",
        requestedPosition: 1,
        positionOverridden: false,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(0);
      expect(res.appliedStrategy).toBe("none");
      expect(fake._rows).toHaveLength(2); // rien supprimé
    });
  });

  describe("réservation dans le job en cours", () => {
    it("évite les positions déjà réservées par un fichier précédent du job", async () => {
      fake = makeFakePrisma([]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        ...BASE,
        requestedPosition: 3,
        positionOverridden: false,
        strategy: "replace",
        assignedOrdersInJob: new Set([0, 1]),
      });
      expect(res.finalOrder).toBe(2);
      expect(res.appliedStrategy).toBe("none");
    });
  });
});
