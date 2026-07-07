/**
 * Régression : `buildAnkorstoreCallbackUrl()` doit ajouter un nonce unique
 * à chaque appel.
 *
 * Sans nonce, deux appels concurrents à `POST /catalog/integrations/operations`
 * envoient un body strictement identique ({ operationType, source, callbackUrl }
 * tous statiques). Ankorstore déduplique ces requêtes identiques et renvoie le
 * MÊME operationId aux deux appelants — bug constaté 2026-07-07 (trois updates
 * différentes sur A1049 / A1649 / A362 en 5 s ont toutes reçu le même
 * `1f179df2-020f-...`). Le second flux tente d'ajouter des produits à une op
 * déjà démarrée → 403 « Products cannot be added to Operation with status
 * [started] ».
 *
 * Le nonce dans la query string suffit pour que le body devienne unique
 * (le webhook ignore ce paramètre — il ne lit que `secret`).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("buildAnkorstoreCallbackUrl — nonce anti-dedup", () => {
  const originalUrl = process.env.NEXTAUTH_URL;
  const originalSecret = process.env.ANKORSTORE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_URL = "https://example.test";
    process.env.ANKORSTORE_WEBHOOK_SECRET = "secret-abc";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = originalUrl;
    process.env.ANKORSTORE_WEBHOOK_SECRET = originalSecret;
  });

  it("contient bien le secret et le path du webhook", async () => {
    const { buildAnkorstoreCallbackUrl } = await import("@/lib/ankorstore-api-write");
    const url = buildAnkorstoreCallbackUrl();
    expect(url).toContain("https://example.test/api/webhooks/ankorstore");
    expect(url).toContain("secret=secret-abc");
  });

  it("ajoute un paramètre nonce", async () => {
    const { buildAnkorstoreCallbackUrl } = await import("@/lib/ankorstore-api-write");
    const url = buildAnkorstoreCallbackUrl();
    const parsed = new URL(url);
    const nonce = parsed.searchParams.get("nonce");
    expect(nonce).toBeTruthy();
    expect(nonce!.length).toBeGreaterThanOrEqual(8);
  });

  it("produit un nonce différent à chaque appel — deux appels rapprochés ne collident pas", async () => {
    const { buildAnkorstoreCallbackUrl } = await import("@/lib/ankorstore-api-write");
    const urls = Array.from({ length: 50 }, () => buildAnkorstoreCallbackUrl());
    const nonces = urls.map((u) => new URL(u).searchParams.get("nonce"));
    const unique = new Set(nonces);
    expect(unique.size).toBe(nonces.length);
  });

  it("URL complète unique à chaque appel (défense contre dedup body-hash côté Ankorstore)", async () => {
    const { buildAnkorstoreCallbackUrl } = await import("@/lib/ankorstore-api-write");
    const a = buildAnkorstoreCallbackUrl();
    const b = buildAnkorstoreCallbackUrl();
    expect(a).not.toBe(b);
  });
});
