import { describe, it, expect, vi } from "vitest";

// Mock next/navigation avant l'import (le composant est client)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/clients",
  useSearchParams: () => new URLSearchParams(),
}));

import { computePageRange } from "@/components/ui/Pagination";

describe("computePageRange", () => {
  it("renvoie toutes les pages si total <= 7", () => {
    expect(computePageRange(1, 1)).toEqual([1]);
    expect(computePageRange(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(computePageRange(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("affiche 1 … n-1 n quand on est au tout début", () => {
    const r = computePageRange(1, 13);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(13);
    expect(r).toContain("…");
  });

  it("affiche 1 2 … n quand on est à la fin", () => {
    const r = computePageRange(13, 13);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(13);
    expect(r).toContain("…");
  });

  it("affiche 1 … p-1 p p+1 … n quand on est au milieu", () => {
    const r = computePageRange(7, 13);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(13);
    expect(r).toContain(6);
    expect(r).toContain(7);
    expect(r).toContain(8);
    expect(r.filter((x) => x === "…").length).toBe(2);
  });

  it("ne double pas les séparateurs quand la page est proche du bord", () => {
    const r = computePageRange(2, 13);
    // Doit contenir 1, 2, 3, …, 13
    expect(r).toContain(1);
    expect(r).toContain(2);
    expect(r).toContain(3);
    expect(r).toContain(13);
    expect(r.filter((x) => x === "…").length).toBeLessThanOrEqual(1);
  });
});
