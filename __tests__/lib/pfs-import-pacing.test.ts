import { describe, it, expect } from "vitest";
import { getImportPacing } from "@/lib/pfs-import-processor";

/**
 * Cadence d'import sur le VPS Hostinger 2 cœurs : pour ménager le CPU et
 * laisser un cœur libre pour servir le site, on bascule automatiquement
 * à partir de 1001 items :
 *  - concurrence 2 → 1 (un seul produit traité à la fois)
 *  - pause inter-lots de 10 s tous les 500 items
 */

describe("getImportPacing", () => {
  it("garde la cadence rapide pour les imports de moins de 1001 items", () => {
    expect(getImportPacing(1)).toEqual({
      concurrency: 2,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
    expect(getImportPacing(500)).toEqual({
      concurrency: 2,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
    expect(getImportPacing(1000)).toEqual({
      concurrency: 2,
      chunkSize: 500,
      chunkPauseMs: 0,
    });
  });

  it("bascule en mode gros import dès 1001 items", () => {
    expect(getImportPacing(1001)).toEqual({
      concurrency: 1,
      chunkSize: 500,
      chunkPauseMs: 10000,
    });
  });

  it("conserve la cadence ralentie pour les très gros imports", () => {
    expect(getImportPacing(9000)).toEqual({
      concurrency: 1,
      chunkSize: 500,
      chunkPauseMs: 10000,
    });
    expect(getImportPacing(50000)).toEqual({
      concurrency: 1,
      chunkSize: 500,
      chunkPauseMs: 10000,
    });
  });

  it("ne plante pas sur 0 items", () => {
    const p = getImportPacing(0);
    expect(p.concurrency).toBeGreaterThan(0);
    expect(p.chunkSize).toBeGreaterThan(0);
  });
});
