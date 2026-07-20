import { describe, it, expect } from "vitest";
import {
  mimeTypeForFormat,
  extensionForFormat,
  stripExtension,
} from "@/components/admin/products/PhotosPanel";

describe("PhotosPanel — helpers de format de téléchargement", () => {
  it("mappe chaque format vers son type MIME", () => {
    expect(mimeTypeForFormat("webp")).toBe("image/webp");
    expect(mimeTypeForFormat("png")).toBe("image/png");
    expect(mimeTypeForFormat("jpeg")).toBe("image/jpeg");
  });

  it("mappe chaque format vers son extension (JPEG → jpg)", () => {
    expect(extensionForFormat("webp")).toBe("webp");
    expect(extensionForFormat("png")).toBe("png");
    expect(extensionForFormat("jpeg")).toBe("jpg");
  });

  it("stripe l'extension d'un nom de fichier existant", () => {
    expect(stripExtension("ref-noir-1.webp")).toBe("ref-noir-1");
    expect(stripExtension("ref-noir-1.jpg")).toBe("ref-noir-1");
    expect(stripExtension("ref-noir-1.jpeg")).toBe("ref-noir-1");
    expect(stripExtension("ref-noir-1.PNG")).toBe("ref-noir-1");
  });

  it("ne casse rien si le nom n'a pas d'extension", () => {
    expect(stripExtension("ref-noir-1")).toBe("ref-noir-1");
    // Le dernier segment fait plus de 5 caractères → pas traité comme extension
    expect(stripExtension("ref.longsegment")).toBe("ref.longsegment");
  });

  it("ne strippe que la dernière extension d'un nom multi-points", () => {
    expect(stripExtension("ref.avec.pts.webp")).toBe("ref.avec.pts");
  });
});
