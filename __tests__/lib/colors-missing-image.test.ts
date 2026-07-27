import { describe, it, expect } from "vitest";
import { countColorsMissingImage } from "@/lib/colors-missing-image";

describe("countColorsMissingImage", () => {
  const productId = "prod-1";
  const key = (colorId: string) => `${productId}::${colorId}`;

  it("returns 0 for archived products (no signal on archived)", () => {
    const images = new Map<string, string>();
    const result = countColorsMissingImage({
      status: "ARCHIVED",
      productId,
      colors: [
        { colorId: "c-red", disabled: false },
        { colorId: "c-blue", disabled: false },
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(0);
  });

  it("counts only active colors without any image", () => {
    const images = new Map<string, string>([[key("c-red"), "/uploads/red.webp"]]);
    const result = countColorsMissingImage({
      status: "ONLINE",
      productId,
      colors: [
        { colorId: "c-red",   disabled: false }, // has image → no
        { colorId: "c-blue",  disabled: false }, // no image  → yes
        { colorId: "c-green", disabled: false }, // no image  → yes
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(2);
  });

  it("ignores disabled colors (not visible on shop, no image needed)", () => {
    const images = new Map<string, string>();
    const result = countColorsMissingImage({
      status: "ONLINE",
      productId,
      colors: [
        { colorId: "c-red",  disabled: true },  // disabled → ignored
        { colorId: "c-blue", disabled: false }, // active, no image → count
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(1);
  });

  it("ignores colors without colorId (safety guard)", () => {
    const images = new Map<string, string>();
    const result = countColorsMissingImage({
      status: "ONLINE",
      productId,
      colors: [
        { colorId: null,     disabled: false },
        { colorId: "c-blue", disabled: false },
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(1);
  });

  it("returns 0 when every active color has an image", () => {
    const images = new Map<string, string>([
      [key("c-red"),  "/uploads/red.webp"],
      [key("c-blue"), "/uploads/blue.webp"],
    ]);
    const result = countColorsMissingImage({
      status: "ONLINE",
      productId,
      colors: [
        { colorId: "c-red",  disabled: false },
        { colorId: "c-blue", disabled: false },
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(0);
  });

  it("deduplicates by colorId (multiple ProductColor rows for same color count once)", () => {
    // Cas réel : un produit peut avoir plusieurs variantes pour la même
    // couleur (ex: UNIT + PACK doré). On ne compte la couleur qu'une fois.
    const images = new Map<string, string>([[key("c-silver"), "/uploads/silver.webp"]]);
    const result = countColorsMissingImage({
      status: "ONLINE",
      productId,
      colors: [
        { colorId: "c-gold",   disabled: false }, // variante UNIT doré, pas d'image
        { colorId: "c-gold",   disabled: false }, // variante PACK doré, pas d'image (même couleur)
        { colorId: "c-silver", disabled: false }, // argenté avec image
      ],
      imagesByProductColor: images,
    });
    expect(result).toBe(1); // doré compté une seule fois
  });

  it("also flags OFFLINE and SYNCING products (only ARCHIVED skips)", () => {
    const images = new Map<string, string>();
    const colors = [{ colorId: "c-red", disabled: false }];
    expect(countColorsMissingImage({ status: "OFFLINE", productId, colors, imagesByProductColor: images })).toBe(1);
    expect(countColorsMissingImage({ status: "SYNCING", productId, colors, imagesByProductColor: images })).toBe(1);
  });
});
