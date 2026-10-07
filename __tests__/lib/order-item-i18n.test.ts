import { describe, it, expect } from "vitest";
import { resolveOrderItemName, pickFromI18n } from "@/lib/order-item-i18n";

describe("pickFromI18n", () => {
  it("retourne la valeur pour la locale si elle existe et non vide", () => {
    expect(pickFromI18n({ en: "Hello", de: "Hallo" }, "de")).toBe("Hallo");
  });

  it("ignore une chaîne vide ou whitespace-only", () => {
    expect(pickFromI18n({ en: "   " }, "en")).toBeNull();
    expect(pickFromI18n({ en: "" }, "en")).toBeNull();
  });

  it("retourne null si locale absente", () => {
    expect(pickFromI18n({ en: "Hello" }, "it")).toBeNull();
  });

  it("retourne null si i18n est null, undefined ou non-objet", () => {
    expect(pickFromI18n(null, "en")).toBeNull();
    expect(pickFromI18n(undefined, "en")).toBeNull();
    expect(pickFromI18n("string", "en")).toBeNull();
  });
});

describe("resolveOrderItemName — priorité snapshot → lookup → fallback FR", () => {
  const baseItem = {
    productName: "Collier doré en acier",
    productRef: "A2816E",
    productNameI18n: { en: "Steel gold necklace", de: "Goldene Edelstahl-Halskette" },
  };

  it("locale fr → retourne toujours le productName FR snapshot", () => {
    expect(resolveOrderItemName(baseItem, "fr")).toBe("Collier doré en acier");
    expect(resolveOrderItemName(baseItem, "fr", new Map([["A2816E", "Lookup FR"]]))).toBe("Collier doré en acier");
  });

  it("locale non-FR : utilise le snapshot i18n si présent", () => {
    expect(resolveOrderItemName(baseItem, "en")).toBe("Steel gold necklace");
    expect(resolveOrderItemName(baseItem, "de")).toBe("Goldene Edelstahl-Halskette");
  });

  it("snapshot absent pour la locale : fallback sur le lookup via productRef", () => {
    const lookup = new Map([["A2816E", "Collana oro acciaio"]]);
    expect(resolveOrderItemName(baseItem, "it", lookup)).toBe("Collana oro acciaio");
  });

  it("snapshot gagne sur le lookup (le snapshot est figé à la commande, plus fiable)", () => {
    const lookup = new Map([["A2816E", "Nouveau nom DE post-commande"]]);
    expect(resolveOrderItemName(baseItem, "de", lookup)).toBe("Goldene Edelstahl-Halskette");
  });

  it("ni snapshot ni lookup : retourne le productName FR snapshot", () => {
    expect(resolveOrderItemName(baseItem, "es")).toBe("Collier doré en acier");
    expect(resolveOrderItemName(baseItem, "es", new Map())).toBe("Collier doré en acier");
  });

  it("gère productNameI18n absent (commandes historiques)", () => {
    const legacyItem = { productName: "Produit FR", productRef: "REF123" };
    expect(resolveOrderItemName(legacyItem, "de")).toBe("Produit FR");
    const lookup = new Map([["REF123", "Produkt DE"]]);
    expect(resolveOrderItemName(legacyItem, "de", lookup)).toBe("Produkt DE");
  });
});
