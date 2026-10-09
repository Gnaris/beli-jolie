import { describe, it, expect } from "vitest";
import {
  parseProductFaqDefaults,
  parseProductFaqOverrides,
  resolveProductFaq,
  generateFaqItemId,
  type ProductFaqDefault,
} from "@/lib/product-faq";

describe("parseProductFaqDefaults", () => {
  it("retourne [] pour null / undefined / chaîne vide", () => {
    expect(parseProductFaqDefaults(null)).toEqual([]);
    expect(parseProductFaqDefaults(undefined)).toEqual([]);
    expect(parseProductFaqDefaults("")).toEqual([]);
    expect(parseProductFaqDefaults("   ")).toEqual([]);
  });

  it("retourne [] pour JSON invalide — pas de crash", () => {
    expect(parseProductFaqDefaults("not json")).toEqual([]);
    expect(parseProductFaqDefaults("{oops}")).toEqual([]);
  });

  it("retourne [] si la valeur n'est pas un tableau", () => {
    expect(parseProductFaqDefaults("{}")).toEqual([]);
    expect(parseProductFaqDefaults('"hello"')).toEqual([]);
    expect(parseProductFaqDefaults("42")).toEqual([]);
  });

  it("accepte un tableau JSON stringifié", () => {
    const raw = JSON.stringify([
      { id: "a", title: "Tailles", body: "Vérifier avant achat." },
      { id: "b", title: "Livraison", body: "Sous 48h." },
    ]);
    expect(parseProductFaqDefaults(raw)).toEqual([
      { id: "a", title: "Tailles", body: "Vérifier avant achat." },
      { id: "b", title: "Livraison", body: "Sous 48h." },
    ]);
  });

  it("accepte aussi un tableau natif (pas que du JSON)", () => {
    const items = [{ id: "x", title: "T", body: "B" }];
    expect(parseProductFaqDefaults(items)).toEqual(items);
  });

  it("ignore les entrées sans id", () => {
    const raw = JSON.stringify([
      { id: "", title: "Sans id", body: "..." },
      { id: "ok", title: "OK", body: "..." },
      { title: "Pas d'id du tout", body: "..." },
    ]);
    expect(parseProductFaqDefaults(raw)).toEqual([
      { id: "ok", title: "OK", body: "..." },
    ]);
  });

  it("remplace les champs manquants/mauvais type par des chaînes vides", () => {
    const raw = JSON.stringify([
      { id: "a" },
      { id: "b", title: 42, body: null },
    ]);
    expect(parseProductFaqDefaults(raw)).toEqual([
      { id: "a", title: "", body: "" },
      { id: "b", title: "", body: "" },
    ]);
  });
});

describe("parseProductFaqOverrides", () => {
  it("retourne {} pour null / mauvais type / tableau", () => {
    expect(parseProductFaqOverrides(null)).toEqual({});
    expect(parseProductFaqOverrides(undefined)).toEqual({});
    expect(parseProductFaqOverrides("string")).toEqual({});
    expect(parseProductFaqOverrides([])).toEqual({});
    expect(parseProductFaqOverrides(42)).toEqual({});
  });

  it("accepte un objet string → string", () => {
    expect(parseProductFaqOverrides({ a: "texte", b: "autre" })).toEqual({
      a: "texte",
      b: "autre",
    });
  });

  it("ignore les valeurs non-string", () => {
    expect(
      parseProductFaqOverrides({
        ok: "oui",
        nope: 42,
        bad: null,
        obj: { nested: true },
      }),
    ).toEqual({ ok: "oui" });
  });
});

describe("resolveProductFaq", () => {
  const defaults: ProductFaqDefault[] = [
    { id: "a", title: "Tailles", body: "Vérifier avant achat." },
    { id: "b", title: "Livraison", body: "Sous 48h ouvrées." },
    { id: "c", title: "Entretien", body: "" },
  ];

  it("retourne les textes par défaut sans override", () => {
    expect(resolveProductFaq(defaults, {})).toEqual([
      { id: "a", title: "Tailles", body: "Vérifier avant achat.", isCustom: false },
      { id: "b", title: "Livraison", body: "Sous 48h ouvrées.", isCustom: false },
      { id: "c", title: "Entretien", body: "", isCustom: false },
    ]);
  });

  it("remplace le body par l'override quand il est non vide", () => {
    const result = resolveProductFaq(defaults, { a: "Taille spécifique à ce produit" });
    expect(result[0]).toEqual({
      id: "a",
      title: "Tailles",
      body: "Taille spécifique à ce produit",
      isCustom: true,
    });
    expect(result[1].isCustom).toBe(false);
    expect(result[2].isCustom).toBe(false);
  });

  it("ignore un override vide ou whitespace — retombe sur le défaut", () => {
    const result = resolveProductFaq(defaults, { a: "   ", b: "" });
    expect(result[0].body).toBe("Vérifier avant achat.");
    expect(result[0].isCustom).toBe(false);
    expect(result[1].body).toBe("Sous 48h ouvrées.");
    expect(result[1].isCustom).toBe(false);
  });

  it("ignore silencieusement les clés orphelines (rubrique supprimée)", () => {
    const result = resolveProductFaq(defaults, {
      a: "custom A",
      zzz: "orphan",
      "xxx-not-in-defaults": "autre orphelin",
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result[0].body).toBe("custom A");
  });

  it("préserve l'ordre des défauts quel que soit l'ordre des clés d'override", () => {
    const result = resolveProductFaq(defaults, { c: "C custom", a: "A custom" });
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result[0].body).toBe("A custom");
    expect(result[2].body).toBe("C custom");
  });

  it("retourne [] si defaults vide", () => {
    expect(resolveProductFaq([], { foo: "bar" })).toEqual([]);
  });
});

describe("generateFaqItemId", () => {
  it("génère un id non vide", () => {
    const id = generateFaqItemId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("génère des ids distincts à chaque appel", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateFaqItemId()));
    expect(ids.size).toBe(20);
  });
});
