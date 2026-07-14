import { describe, it, expect } from "vitest";
import {
  pickEfashionVendorPresets,
  type EfashionMarque,
  type EfashionPack,
} from "@/lib/efashion-annexes";

describe("pickEfashionVendorPresets", () => {
  it("prend la marque marquée `defaut` en priorité", () => {
    const marques: EfashionMarque[] = [
      { id: 100, label: "Autre", isDefault: false },
      { id: 200, label: "PRINCIPAL", isDefault: true },
    ];
    const packs: EfashionPack[] = [{ id: 12307, label: "1", quantity: 1 }];
    expect(pickEfashionVendorPresets(marques, packs, 1)).toEqual({
      marque: 200,
      pack: 12307,
    });
  });

  it("fallback sur la première marque si aucune `defaut`", () => {
    const marques: EfashionMarque[] = [
      { id: 42, label: "A", isDefault: false },
      { id: 43, label: "B", isDefault: false },
    ];
    const res = pickEfashionVendorPresets(
      marques,
      [{ id: 999, label: "1", quantity: 1 }],
      1,
    );
    expect("marque" in res && res.marque).toBe(42);
  });

  it("erreur claire si aucune marque configurée", () => {
    const res = pickEfashionVendorPresets(
      [],
      [{ id: 1, label: "1", quantity: 1 }],
      1,
    );
    expect("error" in res).toBe(true);
    expect("error" in res && res.error).toMatch(/Aucune marque/i);
  });

  it("cherche le pack sur `quantity` (pas sur `label`) — cas Issyma", () => {
    // Reproduit la vraie config observée sur le compte Issyma :
    // deux packs partagent le libellé "1" mais des quantités différentes (3 et 1).
    // Le bon pack « 1 unité » est celui dont quantity=1 (id 12307), pas le label.
    const marques: EfashionMarque[] = [
      { id: 2988, label: "ISSYMA", isDefault: true },
    ];
    const packs: EfashionPack[] = [
      { id: 12192, label: "1", quantity: 3 },
      { id: 12307, label: "1", quantity: 1 },
    ];
    expect(pickEfashionVendorPresets(marques, packs, 1)).toEqual({
      marque: 2988,
      pack: 12307,
    });
  });

  it("trouve le bon pack pour une quantité PACK (ex: 12)", () => {
    const marques: EfashionMarque[] = [
      { id: 500, label: "X", isDefault: true },
    ];
    const packs: EfashionPack[] = [
      { id: 12307, label: "1", quantity: 1 },
      { id: 30000, label: "12", quantity: 12 },
      { id: 40000, label: "6", quantity: 6 },
    ];
    expect(pickEfashionVendorPresets(marques, packs, 12)).toEqual({
      marque: 500,
      pack: 30000,
    });
  });

  it("erreur avec liste des packs disponibles si aucun ne matche", () => {
    // Cas Issyma qui recevait auparavant "Le pack ID 12744 n'existe pas" :
    // aucun pack de la quantité demandée → message explicite.
    const marques: EfashionMarque[] = [
      { id: 2988, label: "ISSYMA", isDefault: true },
    ];
    const packs: EfashionPack[] = [
      { id: 12192, label: "1", quantity: 3 },
      { id: 12307, label: "1", quantity: 1 },
    ];
    const res = pickEfashionVendorPresets(marques, packs, 24);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toMatch(/24 unité/);
      expect(res.error).toMatch(/3/);
      expect(res.error).toMatch(/1/);
    }
  });
});
