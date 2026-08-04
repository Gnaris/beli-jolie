import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Test racine du bug qui a fait disparaître la clé secrète Issyma :
 * `updateStripeConfig` recevait `secretKey: undefined` (utilisateur laisse
 * le champ vide, placeholder « déjà en place ») et l'interprétait comme
 * « vider » → `deleteMany` silencieux sur la ligne existante.
 *
 * Distinction attendue :
 *   - `undefined` → « ne touche pas » (pas d'insert, pas de delete)
 *   - `""`        → « vider explicitement » (deleteMany)
 *   - `"sk_…"`    → `setSiteConfig` avec la nouvelle valeur
 */

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({ invalidateStripeCache: vi.fn() }));
vi.mock("@/lib/encryption", () => ({
  encryptIfSensitive: (_key: string, value: string) => `ENC(${value})`,
}));

const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { deleteMany: (...a: unknown[]) => deleteMany(...a) } },
}));

const setSiteConfig = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: (...a: unknown[]) => setSiteConfig(...a),
}));

describe("updateStripeConfig : undefined ≠ '' (bug wipe silencieux)", () => {
  beforeEach(() => {
    deleteMany.mockClear();
    setSiteConfig.mockClear();
  });

  it("champ laissé vide (undefined) → ne touche PAS la ligne BDD existante", async () => {
    const { updateStripeConfig } = await import(
      "@/app/actions/admin/stripe-config"
    );

    // Cliente re-sauve après avoir modifié SEULEMENT la publique + webhook.
    // Le formulaire envoie `secretKey: undefined` (placeholder « déjà en place »).
    const res = await updateStripeConfig({
      secretKey: undefined,
      publishableKey: "pk_test_new",
      webhookSecret: undefined,
    });

    expect(res.success).toBe(true);
    // La clé secrète existante en BDD ne doit PAS être supprimée.
    const deletedKeys = deleteMany.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key);
    expect(deletedKeys).not.toContain("stripe_secret_key");
    expect(deletedKeys).not.toContain("stripe_webhook_secret");
    // Seule la publique est écrite.
    const writtenKeys = setSiteConfig.mock.calls.map((c) => c[0]);
    expect(writtenKeys).toEqual(["stripe_publishable_key"]);
  });

  it("chaîne vide '' → supprime explicitement la ligne BDD", async () => {
    const { updateStripeConfig } = await import(
      "@/app/actions/admin/stripe-config"
    );

    const res = await updateStripeConfig({
      secretKey: "",
      publishableKey: "",
      webhookSecret: "",
    });

    expect(res.success).toBe(true);
    const deletedKeys = deleteMany.mock.calls.map((c) => (c[0] as { where: { key: string } }).where.key);
    expect(deletedKeys).toEqual(
      expect.arrayContaining([
        "stripe_secret_key",
        "stripe_publishable_key",
        "stripe_webhook_secret",
      ]),
    );
    expect(setSiteConfig).not.toHaveBeenCalled();
  });

  it("valeur non vide → chiffre + persiste", async () => {
    const { updateStripeConfig } = await import(
      "@/app/actions/admin/stripe-config"
    );

    const res = await updateStripeConfig({
      secretKey: "sk_test_new",
      publishableKey: "pk_test_new",
      webhookSecret: "whsec_new",
    });

    expect(res.success).toBe(true);
    expect(deleteMany).not.toHaveBeenCalled();
    const calls = setSiteConfig.mock.calls;
    // Les clés sensibles sont chiffrées (préfixe ENC), la publique aussi
    // (encryptIfSensitive retourne l'entrée si la clé n'est pas sensible —
    // ici on mock encryptIfSensitive comme wrap systématique).
    expect(calls).toEqual(
      expect.arrayContaining([
        ["stripe_secret_key", "ENC(sk_test_new)"],
        ["stripe_publishable_key", "ENC(pk_test_new)"],
        ["stripe_webhook_secret", "ENC(whsec_new)"],
      ]),
    );
  });

  it("trim des espaces autour d'une valeur", async () => {
    const { updateStripeConfig } = await import(
      "@/app/actions/admin/stripe-config"
    );

    await updateStripeConfig({ publishableKey: "  pk_test_trimmed  " });
    const calls = setSiteConfig.mock.calls;
    expect(calls).toEqual([["stripe_publishable_key", "ENC(pk_test_trimmed)"]]);
  });
});
