import { describe, it, expect } from "vitest";
import { getImportPacing } from "@/lib/pfs-import-processor";

/**
 * Cadence d'import : pour ménager PFS et le VPS sur les très gros lots,
 * on bascule automatiquement à partir de 1001 items :
 *  - concurrence 6 → 3 (moins de calls PFS en parallèle)
 *  - pause inter-lots de 5 s tous les 500 items (laisse PFS récupérer)
 */

describe("getImportPacing", () => {
  it("garde la cadence rapide pour les imports de moins de 1001 items", () => {
    expect(getImportPacing(1)).toEqual({
      concurrency: 6,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
    expect(getImportPacing(500)).toEqual({
      concurrency: 6,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
    expect(getImportPacing(1000)).toEqual({
      concurrency: 6,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
  });

  it("bascule en mode gros import dès 1001 items", () => {
    expect(getImportPacing(1001)).toEqual({
      concurrency: 3,
      chunkSize: 500,
      chunkPauseMs: 5000,
    });
  });

  it("conserve la cadence ralentie pour les très gros imports", () => {
    expect(getImportPacing(9000)).toEqual({
      concurrency: 3,
      chunkSize: 500,
      chunkPauseMs: 5000,
    });
    expect(getImportPacing(50000)).toEqual({
      concurrency: 3,
      chunkSize: 500,
      chunkPauseMs: 5000,
    });
  });

  it("ne plante pas sur 0 items", () => {
    const p = getImportPacing(0);
    expect(p.concurrency).toBeGreaterThan(0);
    expect(p.chunkSize).toBeGreaterThan(0);
  });
});
