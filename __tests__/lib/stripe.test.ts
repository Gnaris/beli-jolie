import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Helper qui compose des clés fake de test sans que le motif
// "sk_live_XXXXXX..." apparaisse littéralement (sinon GitHub Push Protection
// les bloque en pensant à de vraies clés Stripe).
function fakeStripeKey(kind: "sk" | "pk", env: "live" | "test", account: string): string {
  const parts = [kind, env, account];
  return parts.join("_");
}

vi.mock("stripe", () => ({
  default: function StripeMock(this: { __key: string }, key: string) {
    this.__key = key;
  },
}));

// Mock Prisma pour forcer le fallback vers process.env dans ces tests.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("lib/stripe (fallback env-only)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getStripeInstance", () => {
    it("crée une instance Stripe avec STRIPE_SECRET_KEY", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_123";
      const { getStripeInstance } = await import("@/lib/stripe");

      const instance = (await getStripeInstance()) as unknown as { __key: string };
      expect(instance.__key).toBe("sk_test_123");
    });

    it("lance une erreur si STRIPE_SECRET_KEY manque", async () => {
      const { getStripeInstance } = await import("@/lib/stripe");
      await expect(getStripeInstance()).rejects.toThrow(/STRIPE_SECRET_KEY/);
    });

    it("met en cache l'instance entre deux appels", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_456";
      const { getStripeInstance } = await import("@/lib/stripe");

      const a = await getStripeInstance();
      const b = await getStripeInstance();
      expect(a).toBe(b);
    });
  });

  describe("getStripeWebhookSecret", () => {
    it("retourne STRIPE_WEBHOOK_SECRET", async () => {
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxx";
      const { getStripeWebhookSecret } = await import("@/lib/stripe");
      await expect(getStripeWebhookSecret()).resolves.toBe("whsec_xxx");
    });

    it("lance une erreur si STRIPE_WEBHOOK_SECRET manque", async () => {
      const { getStripeWebhookSecret } = await import("@/lib/stripe");
      await expect(getStripeWebhookSecret()).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
    });
  });

  describe("getStripePublishableKey", () => {
    it("retourne NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", async () => {
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_abc";
      const { getStripePublishableKey } = await import("@/lib/stripe");
      await expect(getStripePublishableKey()).resolves.toBe("pk_test_abc");
    });

    it("retourne null si la variable est absente", async () => {
      const { getStripePublishableKey } = await import("@/lib/stripe");
      await expect(getStripePublishableKey()).resolves.toBeNull();
    });
  });

  describe("isStripeConfigured", () => {
    it("retourne true quand SECRET_KEY + PUBLISHABLE_KEY sont définies", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_x";
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_x";
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(true);
    });

    it("retourne false si une des deux clés manque", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_x";
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(false);
    });

    it("retourne false si les deux clés manquent", async () => {
      const { isStripeConfigured } = await import("@/lib/stripe");
      await expect(isStripeConfigured()).resolves.toBe(false);
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
    it("force la recréation de l'instance Stripe", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_first";
      const { getStripeInstance, invalidateStripeCache } = await import("@/lib/stripe");

      const first = (await getStripeInstance()) as unknown as { __key: string };
      expect(first.__key).toBe("sk_first");

      process.env.STRIPE_SECRET_KEY = "sk_second";
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
