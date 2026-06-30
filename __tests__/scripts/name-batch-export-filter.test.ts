import { describe, it, expect } from "vitest";
import { buildExportWhereClause } from "@/lib/name-batch-export-filter";

describe("buildExportWhereClause", () => {
  it("inclut le filtre status ONLINE", () => {
    const w = buildExportWhereClause();
    expect(w.status).toBe("ONLINE");
  });

  it("exclut les produits dont la note contient la mention IA", () => {
    const w = buildExportWhereClause();
    expect(w.OR).toEqual([
      { note: null },
      { note: { not: { contains: "Complété par l'IA" } } },
    ]);
  });
});
