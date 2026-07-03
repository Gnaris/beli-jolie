import { describe, it, expect } from "vitest";
import { initialsOf, avatarGradientFor, AVATAR_GRADIENT_COUNT } from "@/lib/user-avatar";

describe("initialsOf", () => {
  it("retourne les 2 premières initiales en majuscule", () => {
    expect(initialsOf("Camille", "Laurent")).toBe("CL");
    expect(initialsOf("sophie", "renaud")).toBe("SR");
  });

  it("tolère les valeurs manquantes", () => {
    expect(initialsOf(null, "Dupont")).toBe("D");
    expect(initialsOf("Marc", null)).toBe("M");
    expect(initialsOf(null, null)).toBe("?");
    expect(initialsOf("", "")).toBe("?");
  });

  it("ignore les espaces autour", () => {
    expect(initialsOf("  Julie  ", "  Garnier ")).toBe("JG");
  });
});

describe("avatarGradientFor", () => {
  it("retourne toujours une classe Tailwind valide", () => {
    const g = avatarGradientFor("cluser_abc123");
    expect(g).toMatch(/^bg-gradient-to-br from-\w+-\d+ to-\w+-\d+$/);
  });

  it("est déterministe pour un même seed", () => {
    expect(avatarGradientFor("user-42")).toBe(avatarGradientFor("user-42"));
  });

  it("répartit les seeds sur toute la palette", () => {
    const buckets = new Set<string>();
    for (let i = 0; i < 100; i++) buckets.add(avatarGradientFor(`user-${i}`));
    // Au moins la moitié des dégradés doivent être atteints sur 100 seeds.
    expect(buckets.size).toBeGreaterThanOrEqual(Math.ceil(AVATAR_GRADIENT_COUNT / 2));
  });

  it("retourne un dégradé par défaut si seed vide", () => {
    expect(avatarGradientFor("")).toMatch(/^bg-gradient-to-br /);
  });
});
