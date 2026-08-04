import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Helper qui compose des clés fake de test sans que le motif
// "sk_live_XXXXXX..." apparaisse littéralement (sinon GitHub Push Protection
// les bloque en pensant à de vraies clés Stripe).
function fakeStripeKey(kind: "sk" | "pk", env: "live" | "test", account: string): string {
  return `${kind}_${env}_${account}`;
}

vi.mock("stripe", () => ({
  default: function StripeMock(this: { __key: string }, key: string) {
    this.__key = key;
  },
}));

// Décrypt = passthrough : la valeur en BDD est traitée telle quelle.
vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: (_key: string, value: string) => value,
  encryptIfSensitive: (_key: string, value: string) => value,
}));

// Tenant courant : la lib/stripe résout tid via ALS, sinon via headers.
// On lui pose "T1" en dur pour tous les tests (sinon readStripeConfig
// renvoie null null null par sécurité).
vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: () => "T1",
}));

// Mock Prisma : chaque test contrôle les rows renvoyées par findMany.
const siteConfigFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: (...args: unknown[]) => siteConfigFindMany(...args),
    },
  },
}));

function rowsFrom(cfg: Record<string, string | undefined>) {
  return Object.entries(cfg)
    .filter(([, v]) => !!v)
    .map(([key, value]) => ({ key, value }));
}

describe("lib/stripe — strict BDD par tenant (plus de fallback env)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    siteConfigFindMany.mockReset();
    // Poser des vars env "polluées" : elles ne doivent JAMAIS être lues.
    process.env.STRIPE_SECRET_KEY = "sk_env_polluted_should_be_ignored";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_env_polluted";
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_env_polluted";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getStripeInstance", () => {
    it("crée l'instance avec la clé secrète BDD du tenant (jamais l'env)", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_test_from_db" })
      );
      const { getStripeInstance } = await import("@/lib/stripe");

      const instance = (await getStripeInstance()) as unknown as { __key: string };
      expect(instance.__key).toBe("sk_test_from_db");
      expect(instance.__key).not.toContain("polluted");
    });

    it("lance une erreur si la BDD tenant n'a pas de clé secrète (pas de fallback env)", async () => {
      siteConfigFindMany.mockResolvedValue([]);
      const { getStripeInstance } = await import("@/lib/stripe");
      await expect(getStripeInstance()).rejects.toThrow(/Stripe non configuré/);
    });

    it("met en cache l'instance entre deux appels", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_test_cache" })
      );
      const { getStripeInstance } = await import("@/lib/stripe");

      const a = await getStripeInstance();
      const b = await getStripeInstance();
      expect(a).toBe(b);
    });
  });

  describe("getStripeWebhookSecret", () => {
    it("retourne la signature de la BDD tenant", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_webhook_secret: "whsec_from_db" })
      );
      const { getStripeWebhookSecret } = await import("@/lib/stripe");
      await expect(getStripeWebhookSecret()).resolves.toBe("whsec_from_db");
    });

    it("lance une erreur si la BDD tenant n'a pas de signature (pas de fallback env)", async () => {
      siteConfigFindMany.mockResolvedValue([]);
      const { getStripeWebhookSecret } = await import("@/lib/stripe");
      await expect(getStripeWebhookSecret()).rejects.toThrow(/webhook/i);
    });
  });

  describe("getStripePublishableKey", () => {
    it("retourne la clé publique BDD du tenant", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_publishable_key: "pk_test_from_db" })
      );
      const { getStripePublishableKey } = await import("@/lib/stripe");
      await expect(getStripePublishableKey()).resolves.toBe("pk_test_from_db");
    });

    it("retourne null si la BDD tenant n'a pas de clé publique (pas de fallback env)", async () => {
      siteConfigFindMany.mockResolvedValue([]);
      const { getStripePublishableKey } = await import("@/lib/stripe");
      await expect(getStripePublishableKey()).resolves.toBeNull();
    });
  });

  describe("isStripeConfigured", () => {
    it("true quand sk et pk sont présentes en BDD tenant", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_x", stripe_publishable_key: "pk_x" })
      );
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(true);
    });

    it("false si une des deux clés manque en BDD tenant (pas de fallback env)", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_x" })
      );
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(false);
    });

    it("false si les deux clés manquent", async () => {
      siteConfigFindMany.mockResolvedValue([]);
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(false);
    });
  });

  describe("garantie multi-tenant : env est ignoré même s'il contient des clés", () => {
    it("BDD tenant vide + env plein → Stripe considéré comme non configuré", async () => {
      // Env pollué par beforeEach, BDD vide
      siteConfigFindMany.mockResolvedValue([]);
      const { isStripeConfigured, getStripePublishableKey } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(false);
      await expect(getStripePublishableKey()).resolves.toBeNull();
    });

    it("mélange BDD-tenant / env impossible : la clé publique ne vient jamais de env", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({
          stripe_secret_key: "sk_test_from_db",
          // pk manquant en BDD → doit rester null, pas retomber sur env
        })
      );
      const { getStripePublishableKey } = await import("@/lib/stripe");
      await expect(getStripePublishableKey()).resolves.toBeNull();
    });
  });

  describe("buildStatementDescriptor", () => {
    it("retourne le nom de boutique tel quel s'il est valide", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      expect(buildStatementDescriptor("Beli & Jolie")).toBe("Beli & Jolie");
    });

    it("supprime les caractères interdits par Stripe", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      expect(buildStatementDescriptor('Boutique "Test"')).toBe("Boutique Test");
      expect(buildStatementDescriptor("Shop <Promo*>")).toBe("Shop Promo");
    });

    it("tronque à 22 caractères maximum", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      const result = buildStatementDescriptor("Une Boutique Au Nom Beaucoup Trop Long");
      expect(result?.length).toBeLessThanOrEqual(22);
      expect(result).toBe("Une Boutique Au Nom Be");
    });

    it("retourne undefined si le nom est trop court après nettoyage", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      expect(buildStatementDescriptor("ABC")).toBeUndefined();
      expect(buildStatementDescriptor('"\\*')).toBeUndefined();
    });

    it("retourne undefined si le résultat ne contient aucune lettre", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      expect(buildStatementDescriptor("12345")).toBeUndefined();
      expect(buildStatementDescriptor("12345678")).toBeUndefined();
    });

    it("compresse les espaces multiples et trim", async () => {
      const { buildStatementDescriptor } = await import("@/lib/stripe");
      expect(buildStatementDescriptor("  Beli   Jolie  ")).toBe("Beli Jolie");
    });
  });

  describe("invalidateStripeCache", () => {
    it("force la recréation de l'instance Stripe après changement de clé BDD", async () => {
      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_first" })
      );
      const { getStripeInstance, invalidateStripeCache } = await import("@/lib/stripe");

      const first = (await getStripeInstance()) as unknown as { __key: string };
      expect(first.__key).toBe("sk_first");

      siteConfigFindMany.mockResolvedValue(
        rowsFrom({ stripe_secret_key: "sk_second" })
      );
      invalidateStripeCache();

      const second = (await getStripeInstance()) as unknown as { __key: string };
      expect(second.__key).toBe("sk_second");
    });
  });

  describe("stripeAccountPrefix", () => {
    it("extrait 16 chars après sk_live_ / sk_test_", async () => {
      const { stripeAccountPrefix } = await import("@/lib/stripe");
      const acctA = "FAKEaaaaaaaaaaaaFAKEfakefakefakefakefakefakefakefakef";
      const acctB = "FAKEbbbbbbbbbbbbFAKEfakefakefakefakefakefakefakefakef";
      expect(stripeAccountPrefix(fakeStripeKey("sk", "live", acctA))).toBe(
        "FAKEaaaaaaaaaaaa",
      );
      expect(stripeAccountPrefix(fakeStripeKey("sk", "test", acctB))).toBe(
        "FAKEbbbbbbbbbbbb",
      );
    });

    it("extrait le préfixe compte des clés publiques aussi", async () => {
      const { stripeAccountPrefix } = await import("@/lib/stripe");
      const acctA = "FAKEaaaaaaaaaaaaFAKEfakefakefakefakefakefakefakefakef";
      expect(stripeAccountPrefix(fakeStripeKey("pk", "live", acctA))).toBe(
        "FAKEaaaaaaaaaaaa",
      );
    });

    it("renvoie null pour null/undefined/vide/format inattendu", async () => {
      const { stripeAccountPrefix } = await import("@/lib/stripe");
      expect(stripeAccountPrefix(null)).toBeNull();
      expect(stripeAccountPrefix(undefined)).toBeNull();
      expect(stripeAccountPrefix("")).toBeNull();
      expect(stripeAccountPrefix("whsec_xxx")).toBeNull();
      expect(stripeAccountPrefix(fakeStripeKey("sk", "live", "short"))).toBeNull();
    });

    it("détecte un mismatch sk/pk : préfixes différents", async () => {
      const { stripeAccountPrefix } = await import("@/lib/stripe");
      const acctA = "FAKEaaaaaaaaaaaaFAKEfakefakefakefakefakefakefakefakef";
      const acctB = "FAKEbbbbbbbbbbbbFAKEfakefakefakefakefakefakefakefakef";
      const sk = stripeAccountPrefix(fakeStripeKey("sk", "live", acctB));
      const pk = stripeAccountPrefix(fakeStripeKey("pk", "live", acctA));
      expect(sk).not.toBe(pk); // simule bug de mismatch clés vs compte
    });

    it("mismatch = false quand sk et pk viennent du même compte", async () => {
      const { stripeAccountPrefix } = await import("@/lib/stripe");
      const acctB = "FAKEbbbbbbbbbbbbFAKEfakefakefakefakefakefakefakefakef";
      const sk = stripeAccountPrefix(fakeStripeKey("sk", "live", acctB));
      const pk = stripeAccountPrefix(fakeStripeKey("pk", "live", acctB));
      expect(sk).toBe(pk);
    });
  });
});

describe("lib/stripe — hors requête (pas de tenant résolu) refuse de lire", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("readStripeConfig renvoie tout null si aucun tenant en ALS + pas de headers", async () => {
    vi.doMock("@/lib/tenant-als", () => ({
      getCurrentTenantIdSync: () => null,
    }));
    vi.doMock("next/headers", () => ({
      headers: async () => ({ get: () => null }),
    }));
    vi.doMock("@/lib/encryption", () => ({
      decryptIfSensitive: (_k: string, v: string) => v,
      encryptIfSensitive: (_k: string, v: string) => v,
    }));
    const stubFindMany = vi.fn().mockResolvedValue([
      { key: "stripe_secret_key", value: "sk_should_not_be_returned" },
    ]);
    vi.doMock("@/lib/prisma", () => ({
      prisma: { siteConfig: { findMany: stubFindMany } },
    }));

    const { isStripeConfigured, getStripePublishableKey } = await import("@/lib/stripe");
    await expect(isStripeConfigured()).resolves.toBe(false);
    await expect(getStripePublishableKey()).resolves.toBeNull();
    // On n'a même pas appelé la BDD : refus dès qu'aucun tenant n'est résolu.
    expect(stubFindMany).not.toHaveBeenCalled();
  });
});
