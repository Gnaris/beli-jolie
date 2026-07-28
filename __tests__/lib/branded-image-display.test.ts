import { describe, expect, it } from "vitest";
import {
  buildBrandedMarketplaceUrl,
  buildBrandedUrl,
  computeDisplayImages,
  isBrandedVirtualId,
  MAX_IMAGES_PER_COLOR,
  maybeBrandifyPath,
} from "@/lib/branded-image-display";

const mkImg = (
  id: string,
  colorId: string,
  order: number,
  path: string,
) => ({ id, colorId, productColorId: null, order, path });

describe("buildBrandedUrl", () => {
  it("encode src et ref, force le size", () => {
    const url = buildBrandedUrl("/uploads/x/produits/e310b/img.webp", "E310B", "large");
    expect(url).toContain("/api/branded-image?");
    expect(url).toContain(`src=${encodeURIComponent("/uploads/x/produits/e310b/img.webp")}`);
    expect(url).toContain("ref=E310B");
    expect(url).toContain("size=large");
  });
});

describe("buildBrandedMarketplaceUrl", () => {
  it("préfixe avec la base URL et supporte format=jpeg", () => {
    const url = buildBrandedMarketplaceUrl(
      "/uploads/x/produits/e310b/img.webp",
      "E310B",
      { baseUrl: "https://beliandjolie.com", size: "large", format: "jpeg" },
    );
    expect(url.startsWith("https://beliandjolie.com/api/branded-image?")).toBe(true);
    expect(url).toContain("format=jpeg");
  });

  it("strip trailing slash sur baseUrl", () => {
    const url = buildBrandedMarketplaceUrl("/uploads/x.webp", "REF", {
      baseUrl: "https://issyma.fr/",
    });
    expect(url).toContain("https://issyma.fr/api/branded-image?");
  });

  it("injecte minWidth=1000 quand fourni (contrainte Faire)", () => {
    const url = buildBrandedMarketplaceUrl("/uploads/x.webp", "REF", {
      baseUrl: "https://beliandjolie.com",
      minWidth: 1000,
    });
    expect(url).toContain("minWidth=1000");
  });

  it("injecte minWidth=500 quand fourni (contrainte Ankorstore)", () => {
    const url = buildBrandedMarketplaceUrl("/uploads/x.webp", "REF", {
      baseUrl: "https://beliandjolie.com",
      minWidth: 500,
    });
    expect(url).toContain("minWidth=500");
  });

  it("n'inclut pas minWidth quand absent", () => {
    const url = buildBrandedMarketplaceUrl("/uploads/x.webp", "REF", {
      baseUrl: "https://beliandjolie.com",
    });
    expect(url).not.toContain("minWidth");
  });
});

describe("maybeBrandifyPath", () => {
  it("retourne le path original quand toggle OFF", () => {
    const res = maybeBrandifyPath("/uploads/x.webp", "c1", "c1", "REF", false);
    expect(res).toBe("/uploads/x.webp");
  });

  it("retourne le path original quand ce n'est pas la couleur principale", () => {
    const res = maybeBrandifyPath("/uploads/x.webp", "c2", "c1", "REF", true);
    expect(res).toBe("/uploads/x.webp");
  });

  it("retourne l'URL branded quand toggle ON + couleur principale", () => {
    const res = maybeBrandifyPath("/uploads/x.webp", "c1", "c1", "REF", true);
    expect(res).toContain("/api/branded-image?");
    expect(res).toContain("ref=REF");
  });

  it("null in → null out", () => {
    expect(maybeBrandifyPath(null, "c1", "c1", "REF", true)).toBeNull();
  });
});

describe("computeDisplayImages", () => {
  it("toggle OFF : renvoie exactement les images d'entrée", () => {
    const images = [
      mkImg("i1", "c1", 0, "/u/1.webp"),
      mkImg("i2", "c1", 1, "/u/2.webp"),
    ];
    const res = computeDisplayImages({
      images, primaryColorId: "c1", reference: "R1", brandedEnabled: false,
    });
    expect(res).toHaveLength(2);
    expect(res.every((r) => !r.isBranded)).toBe(true);
  });

  it("toggle ON + pas de couleur principale : passthrough", () => {
    const images = [mkImg("i1", "c1", 0, "/u/1.webp")];
    const res = computeDisplayImages({
      images, primaryColorId: null, reference: "R1", brandedEnabled: true,
    });
    expect(res.every((r) => !r.isBranded)).toBe(true);
  });

  it("toggle ON : injecte le branded en position 0 de la couleur principale, décale les autres", () => {
    const images = [
      mkImg("i1", "c1", 0, "/u/1.webp"),
      mkImg("i2", "c1", 1, "/u/2.webp"),
      mkImg("i3", "c2", 0, "/u/3.webp"),
    ];
    const res = computeDisplayImages({
      images, primaryColorId: "c1", reference: "REF", brandedEnabled: true,
    });
    const c1 = res.filter((r) => r.colorId === "c1");
    const c2 = res.filter((r) => r.colorId === "c2");
    // c1 : branded (0), i1 (1), i2 (2)
    expect(c1).toHaveLength(3);
    expect(c1[0]!.isBranded).toBe(true);
    expect(c1[0]!.order).toBe(0);
    expect(c1[1]!.id).toBe("i1");
    expect(c1[1]!.order).toBe(1);
    expect(c1[2]!.id).toBe("i2");
    expect(c1[2]!.order).toBe(2);
    // c2 : inchangé
    expect(c2).toHaveLength(1);
    expect(c2[0]!.isBranded).toBe(false);
  });

  it("cap à 5 sur la couleur principale : drop la dernière image quand déjà 5", () => {
    const images = Array.from({ length: 5 }, (_, i) =>
      mkImg(`i${i}`, "c1", i, `/u/${i}.webp`),
    );
    const res = computeDisplayImages({
      images, primaryColorId: "c1", reference: "REF", brandedEnabled: true,
    });
    expect(res).toHaveLength(MAX_IMAGES_PER_COLOR);
    expect(res[0]!.isBranded).toBe(true);
    expect(res[res.length - 1]!.id).toBe("i3"); // i4 a été droppée
  });

  it("l'URL branded pointe vers /api/branded-image avec la référence et le path source", () => {
    const images = [mkImg("i1", "c1", 0, "/uploads/x/produits/g/g-1.webp")];
    const res = computeDisplayImages({
      images, primaryColorId: "c1", reference: "G208A", brandedEnabled: true,
    });
    expect(res[0]!.path).toContain("/api/branded-image?");
    expect(res[0]!.path).toContain("ref=G208A");
    expect(res[0]!.urlThumb).toContain("size=thumb");
    expect(res[0]!.urlMedium).toContain("size=medium");
  });

  it("expose isBrandedVirtualId comme prédicat sur l'id retourné", () => {
    const images = [mkImg("real-id", "c1", 0, "/u/1.webp")];
    const res = computeDisplayImages({
      images, primaryColorId: "c1", reference: "REF", brandedEnabled: true,
    });
    expect(isBrandedVirtualId(res[0]!.id)).toBe(true);
    expect(isBrandedVirtualId(res[1]!.id)).toBe(false);
  });
});
