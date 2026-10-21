import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks des dépendances serveur AVANT l'import de la lib.
const mockedFindFirst = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transactionalEmailOverride: {
      findFirst: (...args: unknown[]) => mockedFindFirst(...args),
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  interpolateTemplate,
  renderTransactionalEmail,
} from "@/lib/transactional-email-render";
import { TRANSACTIONAL_DEFAULTS } from "@/lib/transactional-email-defaults";

describe("interpolateTemplate", () => {
  it("remplace les tokens connus", () => {
    const out = interpolateTemplate("Bonjour {firstName} !", { firstName: "Marie" });
    expect(out).toBe("Bonjour Marie !");
  });

  it("conserve les tokens inconnus (visibles → repérables)", () => {
    const out = interpolateTemplate("Hello {unknown}", { firstName: "Marie" });
    expect(out).toBe("Hello {unknown}");
  });

  it("gère plusieurs tokens dans la même chaîne", () => {
    const out = interpolateTemplate("{a} + {b} = {a}{b}", { a: "1", b: "2" });
    expect(out).toBe("1 + 2 = 12");
  });

  it("accepte les nombres (convertis en string)", () => {
    const out = interpolateTemplate("Total : {n} €", { n: 42 });
    expect(out).toBe("Total : 42 €");
  });

  it("ignore null et undefined", () => {
    const out = interpolateTemplate("Val : {x}", { x: null });
    expect(out).toBe("Val : {x}");
  });

  it("ne touche pas aux chaînes vides", () => {
    expect(interpolateTemplate("", { firstName: "Marie" })).toBe("");
  });

  it("supporte les tokens avec underscore et chiffres", () => {
    const out = interpolateTemplate("{order_1} / {order2}", {
      order_1: "A",
      order2: "B",
    });
    expect(out).toBe("A / B");
  });
});

describe("renderTransactionalEmail", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
  });

  it("retombe sur le défaut quand aucun override", async () => {
    mockedFindFirst.mockResolvedValue(null);
    const rendered = await renderTransactionalEmail({
      scenarioKey: "LOGIN_OTP",
      vars: { code: "123456", shopName: "Beli & Jolie" },
    });
    expect(rendered.source).toBe("default");
    expect(rendered.subject).toContain("Beli & Jolie");
    expect(rendered.html).toContain("123456");
  });

  it("utilise l'override FR quand il existe", async () => {
    mockedFindFirst.mockResolvedValue({
      subject: "Mon code : {code}",
      html: "<p>Code personnalisé : {code}</p>",
    });
    const rendered = await renderTransactionalEmail({
      scenarioKey: "LOGIN_OTP",
      vars: { code: "987654" },
    });
    expect(rendered.source).toBe("override");
    expect(rendered.subject).toBe("Mon code : 987654");
    expect(rendered.html).toBe("<p>Code personnalisé : 987654</p>");
  });

  it("retombe sur le défaut si l'override lève une erreur BDD", async () => {
    mockedFindFirst.mockRejectedValue(new Error("Prisma down"));
    const rendered = await renderTransactionalEmail({
      scenarioKey: "LOGIN_OTP",
      vars: { code: "111222", shopName: "Beli" },
    });
    expect(rendered.source).toBe("default");
    expect(rendered.html).toContain("111222");
  });

  it("utilise la version localisée EN quand elle existe et non vide", async () => {
    mockedFindFirst.mockResolvedValue({
      subject: "FR subject",
      html: "<p>FR html</p>",
      locales: [{ subject: "EN subject {code}", html: "<p>EN html {code}</p>" }],
    });
    const rendered = await renderTransactionalEmail({
      scenarioKey: "LOGIN_OTP",
      locale: "en",
      vars: { code: "A1B2C3" },
    });
    expect(rendered.source).toBe("override");
    expect(rendered.subject).toBe("EN subject A1B2C3");
    expect(rendered.html).toBe("<p>EN html A1B2C3</p>");
  });

  it("retombe sur le FR si la version localisée a un html vide", async () => {
    mockedFindFirst.mockResolvedValue({
      subject: "FR {code}",
      html: "<p>FR {code}</p>",
      locales: [{ subject: "EN sans contenu", html: "" }],
    });
    const rendered = await renderTransactionalEmail({
      scenarioKey: "LOGIN_OTP",
      locale: "en",
      vars: { code: "XYZ" },
    });
    expect(rendered.source).toBe("override");
    expect(rendered.html).toBe("<p>FR XYZ</p>");
  });
});

describe("TRANSACTIONAL_DEFAULTS", () => {
  it("fournit un template pour chaque scénario du registre", async () => {
    const { TRANSACTIONAL_SCENARIOS } = await import("@/lib/transactional-email-scenarios");
    for (const scenario of TRANSACTIONAL_SCENARIOS) {
      expect(TRANSACTIONAL_DEFAULTS[scenario.key]).toBeDefined();
      expect(TRANSACTIONAL_DEFAULTS[scenario.key].subject.length).toBeGreaterThan(0);
      expect(TRANSACTIONAL_DEFAULTS[scenario.key].html.length).toBeGreaterThan(0);
    }
  });

  it("chaque variable obligatoire du registre apparaît dans le template par défaut (sujet OU html)", async () => {
    const { TRANSACTIONAL_SCENARIOS } = await import("@/lib/transactional-email-scenarios");
    for (const scenario of TRANSACTIONAL_SCENARIOS) {
      const def = TRANSACTIONAL_DEFAULTS[scenario.key];
      const combined = def.subject + "\n" + def.html;
      for (const v of scenario.variables) {
        if (!v.required) continue;
        const re = new RegExp(`\\{${v.token}\\}`);
        expect(re.test(combined), `[${scenario.key}] variable {${v.token}} manque dans le template par défaut`).toBe(true);
      }
    }
  });
});
