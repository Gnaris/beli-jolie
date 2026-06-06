import { describe, it, expect } from "vitest";
import { isSafeMarketplaceImagePath } from "@/lib/marketplace-image";

describe("isSafeMarketplaceImagePath — chemins valides", () => {
  it("accepte un chemin produit standard webp", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/abc/abc-or-1.webp"),
    ).toBe(true);
  });

  it("accepte jpg / jpeg / png / gif / avif", () => {
    expect(isSafeMarketplaceImagePath("/uploads/x/y.jpg")).toBe(true);
    expect(isSafeMarketplaceImagePath("/uploads/x/y.jpeg")).toBe(true);
    expect(isSafeMarketplaceImagePath("/uploads/x/y.png")).toBe(true);
    expect(isSafeMarketplaceImagePath("/uploads/x/y.gif")).toBe(true);
    expect(isSafeMarketplaceImagePath("/uploads/x/y.avif")).toBe(true);
  });

  it("accepte chemins avec tirets, underscores, points", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/ref-123/ref-123_or-md.webp"),
    ).toBe(true);
  });

  it("accepte casse mixte sur l'extension", () => {
    expect(isSafeMarketplaceImagePath("/uploads/x/y.WEBP")).toBe(true);
    expect(isSafeMarketplaceImagePath("/uploads/x/y.JPG")).toBe(true);
  });

  it("accepte les accents latins (couleurs Doré, Crème, Rosé, etc.)", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/a11/a11-doré-1.webp"),
    ).toBe(true);
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/abc/abc-crème-2.webp"),
    ).toBe(true);
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/xyz/xyz-rosé-thumb.webp"),
    ).toBe(true);
  });

  it("accepte les parenthèses (suffixe de duplication, ex. G212(2))", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/g212(2)/g212(2)-noir-1.webp"),
    ).toBe(true);
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/g212(2)/g212(2)-doré-1-md.webp"),
    ).toBe(true);
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/abc(10)/abc(10)-bleu-thumb.webp"),
    ).toBe(true);
  });
});

describe("isSafeMarketplaceImagePath — path traversal bloqué", () => {
  it("refuse '..' dans le chemin (remontée vers private/)", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/../private/uploads/factures/a.pdf"),
    ).toBe(false);
  });

  it("refuse '..' segmenté", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/produits/../../private/kbis/abc.pdf"),
    ).toBe(false);
  });

  it("refuse un '..' caché en fin", () => {
    expect(isSafeMarketplaceImagePath("/uploads/produits/abc/..")).toBe(false);
  });

  it("refuse l'antislash Windows", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads\\..\\private\\factures\\a.pdf"),
    ).toBe(false);
  });

  it("refuse les null bytes", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/x.webp\0/private/factures/a.pdf"),
    ).toBe(false);
  });

  it("refuse les caractères '%' (anti URL-encoding trompeur)", () => {
    expect(
      isSafeMarketplaceImagePath("/uploads/%2e%2e/private/factures/a.pdf"),
    ).toBe(false);
  });
});

describe("isSafeMarketplaceImagePath — préfixe et extensions", () => {
  it("refuse les chemins hors /uploads/", () => {
    expect(isSafeMarketplaceImagePath("/private/uploads/factures/a.pdf")).toBe(
      false,
    );
    expect(isSafeMarketplaceImagePath("/etc/passwd")).toBe(false);
    expect(isSafeMarketplaceImagePath("/secret.webp")).toBe(false);
  });

  it("refuse les extensions non-image", () => {
    expect(isSafeMarketplaceImagePath("/uploads/secret.pdf")).toBe(false);
    expect(isSafeMarketplaceImagePath("/uploads/script.js")).toBe(false);
    expect(isSafeMarketplaceImagePath("/uploads/note.txt")).toBe(false);
  });

  it("refuse fichiers sans extension", () => {
    expect(isSafeMarketplaceImagePath("/uploads/produits/abc")).toBe(false);
  });

  it("refuse null, vide ou chemin absolu Windows", () => {
    expect(isSafeMarketplaceImagePath(null)).toBe(false);
    expect(isSafeMarketplaceImagePath("")).toBe(false);
    expect(isSafeMarketplaceImagePath("C:\\Windows\\System32\\config")).toBe(
      false,
    );
  });
});
