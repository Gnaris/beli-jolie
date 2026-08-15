/**
 * Verrouille le parsing du préfixe numérique et le filtre "URL appartient à ce
 * produit ?". Sans ce filtre, une URL image polluée par le bug Ankor filters[id]
 * reste attachée au mauvais produit à la sync suivante.
 */
import { describe, it, expect } from "vitest";
import {
  ankorImageBelongsToProduct,
  extractAnkorProductIdFromImageUrl,
} from "@/lib/ankorstore-bo/image-url-guard";

describe("extractAnkorProductIdFromImageUrl", () => {
  it("extrait l'ID d'une URL image produit-père", () => {
    expect(
      extractAnkorProductIdFromImageUrl("/products/images/7302183-47fb1aa05d5fa1.jpg")
    ).toBe(7302183);
  });

  it("extrait l'ID d'une URL image variante", () => {
    expect(
      extractAnkorProductIdFromImageUrl("/products/images/7302182-11928762-abc.jpg")
    ).toBe(7302182);
  });

  it("renvoie null pour une URL sans préfixe numérique", () => {
    expect(extractAnkorProductIdFromImageUrl("/products/images/thumbnail.jpg")).toBeNull();
  });

  it("renvoie null pour un file-upload key fraîchement uploadé", () => {
    expect(extractAnkorProductIdFromImageUrl("file-upload:abc123.jpg")).toBeNull();
  });

  it("renvoie null pour chaîne vide", () => {
    expect(extractAnkorProductIdFromImageUrl("")).toBeNull();
  });

  it("renvoie null pour URL externe", () => {
    expect(
      extractAnkorProductIdFromImageUrl("https://example.com/products/images/123-abc.jpg")
    ).toBeNull();
  });
});

describe("ankorImageBelongsToProduct", () => {
  it("true quand le préfixe correspond", () => {
    expect(
      ankorImageBelongsToProduct("/products/images/7302182-abc.jpg", 7302182)
    ).toBe(true);
  });

  it("false quand le préfixe pointe vers un autre produit (contamination)", () => {
    expect(
      ankorImageBelongsToProduct("/products/images/7302183-abc.jpg", 7302182)
    ).toBe(false);
  });

  it("true quand l'URL n'a pas de préfixe (URL neutre = laisser passer)", () => {
    expect(ankorImageBelongsToProduct("file-upload:abc.jpg", 7302182)).toBe(true);
  });

  it("scénario réel BRACELET32 : rejette l'URL polluée de BRACELET31", () => {
    const contaminatedUrl = "/products/images/7302183-47fb1aa05d5fa1.jpg";
    // Produit courant = 7302182 (BRACELET32), URL pollue avec préfixe 7302183 (BRACELET31)
    expect(ankorImageBelongsToProduct(contaminatedUrl, 7302182)).toBe(false);
  });
});
