import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-32bytes-min-do-not-use-in-prod";
});

// L'import doit avoir lieu APRÈS le set env (le module lit `process.env` à
// chaque call `getSecret()` donc pas critique, mais soyons propres).
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from "@/lib/newsletter-unsubscribe-token";

describe("signUnsubscribeToken / verifyUnsubscribeToken", () => {
  it("round-trip : le token signé se vérifie et rend le uid + tid d'origine", () => {
    const t = signUnsubscribeToken({ userId: "user_123", tenantId: "tenant_abc" });
    const check = verifyUnsubscribeToken(t);
    expect(check.valid).toBe(true);
    if (check.valid) {
      expect(check.userId).toBe("user_123");
      expect(check.tenantId).toBe("tenant_abc");
    }
  });

  it("refuse un token dont la signature a été modifiée (bad_signature)", () => {
    const t = signUnsubscribeToken({ userId: "u", tenantId: "t" });
    const [payload] = t.split(".");
    const tampered = `${payload}.AAAAAAAA`;
    const check = verifyUnsubscribeToken(tampered);
    expect(check.valid).toBe(false);
    if (!check.valid) expect(check.reason).toBe("bad_signature");
  });

  it("refuse un token dont le payload a été modifié", () => {
    // On altère le payload → la signature ne correspond plus (bad_signature)
    // au lieu de decoder correctement une autre identité.
    const t = signUnsubscribeToken({ userId: "u", tenantId: "t" });
    const [payload, sig] = t.split(".");
    // Modifie 1 char du payload
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === "A" ? "B" : "A") + "." + sig;
    const check = verifyUnsubscribeToken(tampered);
    expect(check.valid).toBe(false);
  });

  it("refuse un token expiré", () => {
    const t = signUnsubscribeToken({ userId: "u", tenantId: "t", ttlMs: -1000 });
    const check = verifyUnsubscribeToken(t);
    expect(check.valid).toBe(false);
    if (!check.valid) expect(check.reason).toBe("expired");
  });

  it("refuse un token malformed", () => {
    expect(verifyUnsubscribeToken("").valid).toBe(false);
    expect(verifyUnsubscribeToken("nopoint").valid).toBe(false);
    expect(verifyUnsubscribeToken("a.b.c").valid).toBe(false);
  });

  it("buildUnsubscribeUrl produit une URL absolue avec token dans query", () => {
    const url = buildUnsubscribeUrl({
      baseUrl: "https://beliandjolie.com/",
      userId: "u1",
      tenantId: "t1",
    });
    expect(url).toMatch(/^https:\/\/beliandjolie\.com\/api\/newsletter\/unsubscribe\?t=/);
    // Le baseUrl trailing slash est bien retiré
    expect(url).not.toContain("com//api");
    // Le token est vérifiable
    const token = new URL(url).searchParams.get("t")!;
    const check = verifyUnsubscribeToken(token);
    expect(check.valid).toBe(true);
    if (check.valid) {
      expect(check.userId).toBe("u1");
      expect(check.tenantId).toBe("t1");
    }
  });
});
