/**
 * Tests pour `lib/push-preferences.ts` — parsing, defaults, template render,
 * tolérance aux JSON partiels ou invalides.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => {
  let returnValue: { value: string } | null = null;
  return {
    siteConfig: {
      findFirst: vi.fn(async () => returnValue),
    },
    _setValue(v: string | null) {
      returnValue = v == null ? null : { value: v };
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock._setValue(null);
});

describe("renderTemplate", () => {
  it("remplace les placeholders simples", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    expect(renderTemplate("Hello {name}!", { name: "Boris" })).toBe("Hello Boris!");
  });

  it("remplace les placeholders multiples", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    expect(
      renderTemplate("{customer} · {orderNumber}", {
        customer: "ACME",
        orderNumber: "ABCD1234",
      }),
    ).toBe("ACME · ABCD1234");
  });

  it("remplace par chaîne vide quand la valeur est null/undefined/empty", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    expect(renderTemplate("Hello {name}!", { name: null })).toBe("Hello !");
    expect(renderTemplate("Hello {name}!", { name: undefined })).toBe("Hello !");
    expect(renderTemplate("Hello {name}!", {})).toBe("Hello !");
  });

  it("nettoie les séparateurs orphelins · quand un placeholder est vide", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    // "Nouvelle commande ·  · ACME" devient "Nouvelle commande · ACME"
    expect(
      renderTemplate("Nouvelle commande · {amount} · {customer}", {
        amount: "",
        customer: "ACME",
      }),
    ).toBe("Nouvelle commande · ACME");
  });

  it("nettoie les séparateurs en début/fin quand un placeholder est vide", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    expect(renderTemplate("{customer} · {orderNumber}", { customer: "", orderNumber: "X" })).toBe("X");
    expect(renderTemplate("{customer} · {orderNumber}", { customer: "ACME", orderNumber: "" })).toBe("ACME");
  });

  it("accepte les valeurs numériques", async () => {
    const { renderTemplate } = await import("@/lib/push-preferences");
    expect(renderTemplate("{count} commandes", { count: 42 })).toBe("42 commandes");
  });
});

describe("parsePushPreferences", () => {
  it("retourne les defaults sur JSON vide", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    expect(parsePushPreferences("")).toEqual(DEFAULT_PUSH_PREFERENCES);
  });

  it("retourne les defaults sur JSON invalide", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    expect(parsePushPreferences("not json")).toEqual(DEFAULT_PUSH_PREFERENCES);
    expect(parsePushPreferences("null")).toEqual(DEFAULT_PUSH_PREFERENCES);
    expect(parsePushPreferences("[]")).toEqual(DEFAULT_PUSH_PREFERENCES);
  });

  it("complète les entrées manquantes avec les defaults", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const partial = {
      order_new: { enabled: false, title: "Custom", body: "Body" },
    };
    const result = parsePushPreferences(JSON.stringify(partial));
    expect(result.order_new).toEqual({ enabled: false, title: "Custom", body: "Body" });
    expect(result.client_new).toEqual(DEFAULT_PUSH_PREFERENCES.client_new);
    expect(result.claim_new).toEqual(DEFAULT_PUSH_PREFERENCES.claim_new);
    expect(result.chat_message).toEqual(DEFAULT_PUSH_PREFERENCES.chat_message);
  });

  it("ignore les clés inconnues (anti-injection)", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const malicious = {
      order_new: { enabled: true, title: "ok", body: "ok" },
      evil_type: { enabled: true, title: "pwned", body: "x" },
    };
    const result = parsePushPreferences(JSON.stringify(malicious));
    expect("evil_type" in result).toBe(false);
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(DEFAULT_PUSH_PREFERENCES).sort(),
    );
  });

  it("retombe sur le défaut si title est vide (évite d'envoyer un push sans titre)", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const data = { order_new: { enabled: true, title: "   ", body: "body" } };
    const result = parsePushPreferences(JSON.stringify(data));
    expect(result.order_new.title).toBe(DEFAULT_PUSH_PREFERENCES.order_new.title);
    expect(result.order_new.body).toBe("body");
  });

  it("tolère les enabled non-booléen (string, number) → fallback défaut", async () => {
    const { parsePushPreferences, DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const data = { order_new: { enabled: "true", title: "ok", body: "ok" } };
    const result = parsePushPreferences(JSON.stringify(data));
    expect(result.order_new.enabled).toBe(DEFAULT_PUSH_PREFERENCES.order_new.enabled);
  });
});

describe("getPushPreferences", () => {
  it("retourne les defaults quand la clé n'existe pas en BDD", async () => {
    prismaMock._setValue(null);
    const { getPushPreferences } = await import("@/lib/push-preferences-server");
    const { DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const prefs = await getPushPreferences("tenant-A");
    expect(prefs).toEqual(DEFAULT_PUSH_PREFERENCES);
  });

  it("scope la requête au tenant passé", async () => {
    prismaMock._setValue("{}");
    const { getPushPreferences } = await import("@/lib/push-preferences-server");
    await getPushPreferences("tenant-B");
    const args = prismaMock.siteConfig.findFirst.mock.calls[0][0] as {
      where: { tenantId: string; key: string };
    };
    expect(args.where.tenantId).toBe("tenant-B");
    expect(args.where.key).toBe("push_notification_preferences");
  });

  it("retourne les prefs parsées quand la BDD a une valeur", async () => {
    prismaMock._setValue(
      JSON.stringify({ order_new: { enabled: false, title: "X", body: "Y" } }),
    );
    const { getPushPreferences } = await import("@/lib/push-preferences-server");
    const prefs = await getPushPreferences("tenant-A");
    expect(prefs.order_new).toEqual({ enabled: false, title: "X", body: "Y" });
  });

  it("fallback vers defaults si Prisma lève", async () => {
    prismaMock.siteConfig.findFirst.mockRejectedValueOnce(new Error("DB down"));
    const { getPushPreferences } = await import("@/lib/push-preferences-server");
    const { DEFAULT_PUSH_PREFERENCES } = await import("@/lib/push-preferences");
    const prefs = await getPushPreferences("tenant-A");
    expect(prefs).toEqual(DEFAULT_PUSH_PREFERENCES);
  });
});
