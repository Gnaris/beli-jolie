import { describe, it, expect } from "vitest";
import {
  pfsImageFileName,
  efashionImageFileName,
  microstoreImageFileName,
} from "@/lib/marketplace-excel/helpers";

describe("pfsImageFileName", () => {
  it("formate `<ref> <couleur> <N>.JPG` avec extension majuscule", () => {
    expect(pfsImageFileName("A2270", "Doré", 1)).toBe("A2270 Doré 2.JPG");
    expect(pfsImageFileName("E803", "Argent", 0)).toBe("E803 Argent 1.JPG");
  });

  it("préserve les accents et espaces de la couleur", () => {
    expect(pfsImageFileName("X", "Bleu Irisé", 0)).toBe("X Bleu Irisé 1.JPG");
  });

  it("strip les caractères interdits Windows", () => {
    expect(pfsImageFileName('A/B*C?', "Doré", 0)).toBe("ABC Doré 1.JPG");
  });
});

describe("efashionImageFileName", () => {
  it("remplace espaces par tirets, extension JPG", () => {
    expect(efashionImageFileName("A2270", "Doré", 1)).toBe("A2270-Doré-2.JPG");
  });

  it("préserve accents, tiret de la couleur intermédiaire", () => {
    expect(efashionImageFileName("X", "Bleu Irisé", 0)).toBe("X-Bleu-Irisé-1.JPG");
  });
});

describe("microstoreImageFileName", () => {
  it("formate `<ref> <couleur> <N>.JPG` avec N commençant à 1", () => {
    expect(microstoreImageFileName("A2270", "Doré", 1)).toBe("A2270 Doré 2.JPG");
    expect(microstoreImageFileName("E803", "Argent", 0)).toBe("E803 Argent 1.JPG");
  });

  it("remplace `Brun` ou `brun` par `Marron` (mot entier)", () => {
    expect(microstoreImageFileName("X", "Brun", 0)).toBe("X Marron 1.JPG");
    expect(microstoreImageFileName("X", "brun", 0)).toBe("X Marron 1.JPG");
    // « brunâtre » ne contient pas le mot « brun » seul → pas remplacé
    expect(microstoreImageFileName("X", "brunâtre", 0)).toBe("X brunâtre 1.JPG");
  });

  it("préserve `Brun Foncé` ? non — seul `Brun` est un mot entier", () => {
    expect(microstoreImageFileName("X", "Brun Foncé", 0)).toBe("X Marron Foncé 1.JPG");
  });
});
