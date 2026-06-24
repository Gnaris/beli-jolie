import { describe, it, expect } from "vitest";
import {
  parseImageFilename,
  partitionImportableImages,
} from "@/lib/import-images-filter";

describe("parseImageFilename", () => {
  it("parse les noms avec espaces", () => {
    expect(parseImageFilename("A200 Doré 1.jpg")).toEqual({
      reference: "A200",
      color: "Doré",
      position: 1,
    });
  });

  it("parse les noms avec underscores", () => {
    expect(parseImageFilename("A200_Or Rose_2.png")).toEqual({
      reference: "A200",
      color: "Or Rose",
      position: 2,
    });
  });

  it("supporte les noms multi-couleurs (avec virgules)", () => {
    expect(parseImageFilename("A200 Doré,Rouge,Noir 3.jpg")).toEqual({
      reference: "A200",
      color: "Doré,Rouge,Noir",
      position: 3,
    });
  });

  it("normalise la référence en majuscules", () => {
    expect(parseImageFilename("a200 Doré 1.jpg")?.reference).toBe("A200");
  });

  it("rejette les photos iPhone non renommées", () => {
    expect(parseImageFilename("IMG_8870.JPG")).toBeNull();
    expect(parseImageFilename("IMG_9040.JPG")).toBeNull();
  });

  it("rejette les positions hors plage [1, 10]", () => {
    expect(parseImageFilename("A200 Doré 0.jpg")).toBeNull();
    expect(parseImageFilename("A200 Doré 11.jpg")).toBeNull();
    expect(parseImageFilename("A200 Doré abc.jpg")).toBeNull();
  });

  it("rejette les noms sans couleur ou sans référence", () => {
    expect(parseImageFilename(" Doré 1.jpg")).toBeNull();
    expect(parseImageFilename("A200  1.jpg")).toBeNull();
  });
});

describe("partitionImportableImages", () => {
  const make = (name: string) => ({ name });

  it("ignore les noms invalides", () => {
    const files = [
      make("A200 Doré 1.jpg"),
      make("IMG_8870.JPG"),
      make("B500 Argent 2.jpg"),
    ];
    const { toImport, ignored } = partitionImportableImages(files, []);
    expect(toImport.map((f) => f.name)).toEqual(["A200 Doré 1.jpg", "B500 Argent 2.jpg"]);
    expect(ignored.map((f) => f.name)).toEqual(["IMG_8870.JPG"]);
  });

  it("ignore les fichiers dont la référence est inconnue", () => {
    const files = [
      make("A200 Doré 1.jpg"),
      make("ZZZ Doré 1.jpg"),
    ];
    const { toImport, ignored } = partitionImportableImages(files, ["ZZZ Doré 1.jpg"]);
    expect(toImport.map((f) => f.name)).toEqual(["A200 Doré 1.jpg"]);
    expect(ignored.map((f) => f.name)).toEqual(["ZZZ Doré 1.jpg"]);
  });

  it("cumule les deux raisons d'ignorer", () => {
    const files = [
      make("A200 Doré 1.jpg"),
      make("IMG_8870.JPG"),
      make("ZZZ Argent 2.jpg"),
    ];
    const { toImport, ignored } = partitionImportableImages(files, ["ZZZ Argent 2.jpg"]);
    expect(toImport).toHaveLength(1);
    expect(ignored).toHaveLength(2);
  });

  it("retourne toImport vide si tout est ignoré", () => {
    const files = [make("IMG_1.JPG"), make("IMG_2.JPG")];
    const { toImport, ignored } = partitionImportableImages(files, []);
    expect(toImport).toEqual([]);
    expect(ignored).toHaveLength(2);
  });

  it("préserve l'ordre d'entrée dans toImport", () => {
    const files = [
      make("C300 Bleu 5.jpg"),
      make("IMG_BAD.JPG"),
      make("A100 Rouge 1.jpg"),
      make("B200 Vert 3.jpg"),
    ];
    const { toImport } = partitionImportableImages(files, []);
    expect(toImport.map((f) => f.name)).toEqual([
      "C300 Bleu 5.jpg",
      "A100 Rouge 1.jpg",
      "B200 Vert 3.jpg",
    ]);
  });
});
