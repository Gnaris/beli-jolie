import { describe, it, expect } from "vitest";
import { pickDefaultImage } from "@/lib/pfs-import";

describe("pfs-import helpers", () => {
  describe("pickDefaultImage", () => {
    it("retourne null pour null / undefined / objet vide", () => {
      expect(pickDefaultImage(null)).toBeNull();
      expect(pickDefaultImage(undefined)).toBeNull();
      expect(pickDefaultImage({})).toBeNull();
    });

    it("prend la clé DEFAUT si présente (string)", () => {
      const images = {
        DEFAUT: "https://pfs/img-defaut.jpg",
        OTHER: "https://pfs/other.jpg",
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/img-defaut.jpg");
    });

    it("prend la première image de DEFAUT si tableau", () => {
      const images = {
        DEFAUT: ["https://pfs/img-1.jpg", "https://pfs/img-2.jpg"],
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/img-1.jpg");
    });

    it("supporte les alias DEFAULT / default", () => {
      expect(pickDefaultImage({ DEFAULT: "https://x.jpg" })).toBe("https://x.jpg");
      expect(pickDefaultImage({ default: "https://y.jpg" })).toBe("https://y.jpg");
    });

    it("retombe sur la première image trouvée si pas de clé DEFAUT", () => {
      const images = {
        DORE: "https://pfs/dore.jpg",
        ARGENT: ["https://pfs/argent.jpg"],
      };
      const result = pickDefaultImage(images);
      expect([images.DORE, images.ARGENT[0]]).toContain(result);
    });

    it("ignore les valeurs vides et prend la suivante", () => {
      const images = {
        DEFAUT: "",
        DORE: "https://pfs/dore.jpg",
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/dore.jpg");
    });
  });
});
