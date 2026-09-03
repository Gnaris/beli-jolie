import { describe, it, expect } from "vitest";
import {
  MAIL_VARIABLES,
  variablesForScenario,
  buildPreviewContext,
  interpolate,
} from "@/lib/mail-merge-variables";

describe("mail-merge-variables — liste", () => {
  it("expose au moins prénom, nom, email, boutique", () => {
    const tokens = MAIL_VARIABLES.map((v) => v.token);
    expect(tokens).toContain("firstName");
    expect(tokens).toContain("lastName");
    expect(tokens).toContain("email");
    expect(tokens).toContain("shopName");
  });

  it("chaque variable a un previewValue non vide", () => {
    for (const v of MAIL_VARIABLES) {
      expect(v.previewValue.length).toBeGreaterThan(0);
    }
  });
});

describe("mail-merge-variables — variablesForScenario", () => {
  it("scénario null : filtre les dynamiques", () => {
    const vs = variablesForScenario(null);
    const tokens = vs.map((v) => v.token);
    expect(tokens).toContain("firstName"); // commune
    expect(tokens).not.toContain("cartTotal"); // dynamique
    expect(tokens).not.toContain("days"); // dynamique
  });

  it("scénario ABANDONED_CART : inclut cartTotal + cartCount", () => {
    const tokens = variablesForScenario("ABANDONED_CART").map((v) => v.token);
    expect(tokens).toContain("cartTotal");
    expect(tokens).toContain("cartCount");
    expect(tokens).not.toContain("days"); // dyn d'un autre scénario
  });

  it("scénario INACTIVE_CLIENT : inclut days", () => {
    const tokens = variablesForScenario("INACTIVE_CLIENT").map((v) => v.token);
    expect(tokens).toContain("days");
    expect(tokens).not.toContain("cartTotal");
  });

  it("scénario RESTOCK : inclut favoritesCount", () => {
    const tokens = variablesForScenario("RESTOCK").map((v) => v.token);
    expect(tokens).toContain("favoritesCount");
  });
});

describe("mail-merge-variables — interpolate", () => {
  it("substitue un token simple", () => {
    expect(interpolate("Bonjour {firstName}", { firstName: "Marie" })).toBe("Bonjour Marie");
  });

  it("substitue plusieurs tokens", () => {
    expect(
      interpolate("{firstName} {lastName} chez {shopName}", {
        firstName: "Marie",
        lastName: "Dupont",
        shopName: "Beli & Jolie",
      }),
    ).toBe("Marie Dupont chez Beli & Jolie");
  });

  it("conserve les tokens inconnus tels quels", () => {
    expect(interpolate("Bonjour {unknown}", { firstName: "Marie" })).toBe("Bonjour {unknown}");
  });

  it("gère une chaîne sans token", () => {
    expect(interpolate("Bonjour Marie", { firstName: "Marie" })).toBe("Bonjour Marie");
  });

  it("gère chaîne vide", () => {
    expect(interpolate("", { firstName: "X" })).toBe("");
  });

  it("applique la fonction d'escape sur les valeurs substituées", () => {
    const escape = (s: string) => s.replace(/</g, "&lt;");
    expect(
      interpolate("Bonjour {firstName}", { firstName: "<script>" }, escape),
    ).toBe("Bonjour &lt;script>");
  });

  it("n'escape pas les tokens inconnus laissés en place", () => {
    const escape = (s: string) => s.replace(/</g, "&lt;");
    // Un token inconnu comme {a<b} reste tel quel (ne matche pas la regex de token)
    expect(interpolate("Hello {a}", {}, escape)).toBe("Hello {a}");
  });

  it("gère un token qui apparaît plusieurs fois", () => {
    expect(interpolate("{x}{x}{x}", { x: "!" })).toBe("!!!");
  });
});

describe("mail-merge-variables — buildPreviewContext", () => {
  it("null : previewValues des variables communes", () => {
    const ctx = buildPreviewContext(null);
    expect(ctx.firstName).toBe("Marie");
    expect(ctx.shopName).toBe("Beli & Jolie");
    expect(ctx.cartTotal).toBeUndefined(); // dyn absente
  });

  it("ABANDONED_CART : previewValues incluent cartTotal", () => {
    const ctx = buildPreviewContext("ABANDONED_CART");
    expect(ctx.cartTotal).toBe("84,50 €");
    expect(ctx.days).toBeUndefined();
  });
});
