import { describe, it, expect } from "vitest";
import { parsePageParam, paginate } from "@/lib/paginate";

describe("parsePageParam", () => {
  it("retombe sur 1 si absent", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam("")).toBe(1);
  });

  it("retombe sur 1 pour une entrée non numérique", () => {
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("NaN")).toBe(1);
  });

  it("retombe sur 1 pour 0 ou nombre négatif", () => {
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-5")).toBe(1);
  });

  it("lit un entier positif normalement", () => {
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("40")).toBe(40);
  });

  it("prend la partie entière quand suffixe non-numérique", () => {
    // parseInt("3xx", 10) === 3
    expect(parsePageParam("3xx")).toBe(3);
  });
});

describe("paginate", () => {
  it("catégorie vide → 1 page vide", () => {
    expect(paginate(0, 40, 1)).toEqual({ totalPages: 1, currentPage: 1, skip: 0 });
  });

  it("total < perPage → 1 seule page", () => {
    expect(paginate(20, 40, 1)).toEqual({ totalPages: 1, currentPage: 1, skip: 0 });
  });

  it("multiple exact de perPage", () => {
    expect(paginate(80, 40, 1)).toEqual({ totalPages: 2, currentPage: 1, skip: 0 });
    expect(paginate(80, 40, 2)).toEqual({ totalPages: 2, currentPage: 2, skip: 40 });
  });

  it("total non multiple → dernière page partielle", () => {
    // 1598 refs / 40 par page = 40 pages (dernière avec 38 refs)
    expect(paginate(1598, 40, 1)).toMatchObject({ totalPages: 40, currentPage: 1, skip: 0 });
    expect(paginate(1598, 40, 40)).toMatchObject({ totalPages: 40, currentPage: 40, skip: 1560 });
  });

  it("page demandée > totalPages est clampée à la dernière", () => {
    expect(paginate(80, 40, 999)).toEqual({ totalPages: 2, currentPage: 2, skip: 40 });
  });

  it("page 0 ou négative est clampée à 1", () => {
    expect(paginate(80, 40, 0)).toEqual({ totalPages: 2, currentPage: 1, skip: 0 });
    expect(paginate(80, 40, -3)).toEqual({ totalPages: 2, currentPage: 1, skip: 0 });
  });
});
