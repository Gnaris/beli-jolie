import { describe, it, expect, beforeEach } from "vitest";
import { placeImageInVariant } from "@/lib/import-processor";

// In-memory fake Prisma client : simule juste productColorImage avec les méthodes utilisées.
type Row = { id: string; order: number; productColorId: string };

function makeFakePrisma(initialRows: Row[]) {
  const rows: Row[] = [...initialRows];
  let idCounter = initialRows.length + 1;
  const ops: Array<{ kind: "delete" | "update" | "create"; payload: Record<string, unknown> }> = [];

  return {
    productColorImage: {
      findMany: async ({ where, select }: { where: { productColorId: string }; select?: Record<string, boolean> }) => {
        const filtered = rows.filter((r) => r.productColorId === where.productColorId);
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
      // Not used by placeImageInVariant but kept for typing safety
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const newRow = { id: `created-${idCounter++}`, order: data.order as number, productColorId: data.productColorId as string };
        rows.push(newRow);
        ops.push({ kind: "create", payload: data });
        return newRow;
      },
    },
    _rows: rows,
    _ops: ops,
  };
}

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
        productColorId: "v1",
        requestedPosition: 3,
        positionOverridden: false,
        strategy: "replace",
      });
      // Compact toward lowest free slot → 0
      expect(res.finalOrder).toBe(0);
      expect(res.appliedStrategy).toBe("none");
      expect(fake._ops).toHaveLength(0);
    });

    it("respecte l'override de position quand l'utilisatrice a choisi", async () => {
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 3,
        positionOverridden: true,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(2);
      expect(res.appliedStrategy).toBe("none");
    });

    it("respecte le slot demandé si supérieur aux positions occupées", async () => {
      fake = makeFakePrisma([{ id: "a", order: 0, productColorId: "v1" }]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 3,
        positionOverridden: false,
        strategy: "replace",
      });
      // Compact : pos 0 prise, pos 1 libre → finalOrder = 1
      expect(res.finalOrder).toBe(1);
      expect(res.appliedStrategy).toBe("none");
    });
  });

  describe("avec conflit", () => {
    it("replace : supprime l'image existante et garde le slot", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, productColorId: "v1" },
        { id: "b", order: 1, productColorId: "v1" },
        { id: "c", order: 2, productColorId: "v1" },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 2,
        positionOverridden: false,
        strategy: "replace",
      });
      expect(res.finalOrder).toBe(1);
      expect(res.appliedStrategy).toBe("replace");
      expect(fake._ops).toEqual([{ kind: "delete", payload: { id: "b" } }]);
      expect(fake._rows.find((r) => r.id === "b")).toBeUndefined();
    });

    it("shift : décale en cascade pour libérer le slot demandé", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, productColorId: "v1" },
        { id: "b", order: 1, productColorId: "v1" },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 1, // request order=0 ; override forcé pour rester dessus
        positionOverridden: true,
        strategy: "shift",
      });
      expect(res.finalOrder).toBe(0);
      expect(res.appliedStrategy).toBe("shift");
      // a doit avoir été décalée à 1, b à 2 (appliqué dans l'ordre highest→lowest)
      expect(fake._rows.find((r) => r.id === "a")?.order).toBe(1);
      expect(fake._rows.find((r) => r.id === "b")?.order).toBe(2);
    });

    it("next_available : ne touche rien, glisse vers la prochaine libre", async () => {
      fake = makeFakePrisma([
        { id: "a", order: 0, productColorId: "v1" },
        { id: "b", order: 1, productColorId: "v1" },
        { id: "c", order: 2, productColorId: "v1" },
      ]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 1,
        positionOverridden: true,
        strategy: "next_available",
      });
      expect(res.finalOrder).toBe(3);
      expect(res.appliedStrategy).toBe("next_available");
      // Aucune mutation sur les rows existantes
      expect(fake._ops).toEqual([]);
      expect(fake._rows).toHaveLength(3);
    });
  });

  describe("réservation dans le job en cours", () => {
    it("évite les positions déjà réservées par un fichier précédent du job", async () => {
      fake = makeFakePrisma([]);
      const res = await placeImageInVariant({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prismaClient: fake as any,
        productColorId: "v1",
        requestedPosition: 3,
        positionOverridden: false,
        strategy: "replace",
        assignedOrdersInJob: new Set([0, 1]),
      });
      // Pos 0 et 1 réservées en mémoire → finalOrder = 2 (compact remontée)
      expect(res.finalOrder).toBe(2);
      expect(res.appliedStrategy).toBe("none");
    });
  });
});
