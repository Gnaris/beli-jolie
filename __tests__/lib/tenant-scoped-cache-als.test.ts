/**
 * Régression : `tenantScopedCacheWithTid` doit rebind l'ALS tenant dans son
 * callback, sinon le contexte fuit d'un tenant à l'autre à travers la barrière
 * `unstable_cache` de Next.js.
 *
 * Incident 15/07/2026 : le cache eFashion annexes de Beli & Jolie s'est rempli
 * avec les packs d'Issyma parce que `ensureEfashionSession` lisait
 * `getCurrentTenantIdSync()` = null à l'intérieur du callback, retombait sur
 * "global", chargeait des credentials cross-tenant et loguait sur le mauvais
 * compte marketplace. Résultat : refresh eFashion en masse HTTP 400
 * "pack ID 12307 n'existe pas" (pack Issyma envoyé au compte BJ).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/cache : le vrai `unstable_cache` a besoin du runtime Next et
// couvre la sémantique cache-hit/miss ; ici on veut vérifier UNIQUEMENT que
// notre wrapper appelle le callback dans un scope ALS correctement bindé.
// On simule donc un unstable_cache qui appelle le callback "à part" (pattern
// qui casse l'ALS parent).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>) => {
    // Simule le fait que Next.js exécute le callback dans un scope async
    // isolé — sans wrapper, l'ALS parente n'est PAS visible ici.
    return async (...args: unknown[]) => {
      // On force la perte du contexte en passant par setTimeout(0) puis
      // en appelant le callback : c'est équivalent au comportement observé
      // en prod avec `unstable_cache` de Next 16.
      return await new Promise((resolve, reject) => {
        setTimeout(() => {
          fn(...args).then(resolve, reject);
        }, 0);
      });
    };
  },
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.reject(new Error("headers() hors contexte requête")),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: (_k: string, v: string) => v,
}));
vi.mock("@/lib/pfs-api-write", () => ({ pfsGetColors: async () => [] }));
vi.mock("@/lib/marketplace-excel/pfs-taxonomy", () => ({ PFS_COLORS: [] }));
vi.mock("@/lib/marketplace-excel/pfs-color-hex", () => ({
  hexForPfsColor: () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { tenantScopedCacheWithTid } from "@/lib/cached-data";
import { tenantALS, getCurrentTenantIdSync } from "@/lib/tenant-als";

describe("tenantScopedCacheWithTid — ALS binding through unstable_cache", () => {
  beforeEach(() => {
    // Note : impossible de "purger" le memoized `unstable_cache` d'un test à
    // l'autre car il est capturé en closure. Chaque test doit donc utiliser
    // une clé de cache différente pour éviter les hits croisés.
  });

  it("propage le tenantId de l'ALS parent au callback (cas nominal)", async () => {
    const seen: string[] = [];
    const cache = tenantScopedCacheWithTid(
      "test-nominal",
      async (tid) => {
        // Vérifie à la fois l'arg explicite ET l'ALS
        seen.push(`arg:${tid}`);
        seen.push(`als:${getCurrentTenantIdSync() ?? "null"}`);
        return "ok";
      },
      ["test-nominal"],
      { revalidate: 60, tags: ["test"] },
    );

    await tenantALS.run("beliandjolie", () => cache());

    expect(seen).toEqual(["arg:beliandjolie", "als:beliandjolie"]);
  });

  it("rebind l'ALS même si l'unstable_cache execute le callback dans un scope async isolé", async () => {
    // Ce test est la vraie régression. Le mock d'unstable_cache passe par
    // setTimeout(0) → l'ALS parente est perdue → SANS le fix, getCurrentTenantIdSync()
    // renvoie null dans le callback. AVEC le fix, il renvoie le tid capturé.
    let alsInsideCallback: string | null = null;
    const cache = tenantScopedCacheWithTid(
      "test-als-loss",
      async () => {
        alsInsideCallback = getCurrentTenantIdSync();
        return "ok";
      },
      ["test-als-loss"],
      { revalidate: 60, tags: ["test"] },
    );

    await tenantALS.run("issyma", () => cache());

    expect(alsInsideCallback).toBe("issyma");
  });

  it("isole 2 tenants qui appellent le même cache — pas de fuite du 1er au 2ᵉ", async () => {
    const bjCalls: string[] = [];
    const issymaCalls: string[] = [];
    const cache = tenantScopedCacheWithTid(
      "test-isolation",
      async (tid) => {
        if (tid === "beliandjolie") bjCalls.push(getCurrentTenantIdSync() ?? "null");
        else issymaCalls.push(getCurrentTenantIdSync() ?? "null");
        return tid;
      },
      ["test-isolation"],
      { revalidate: 60, tags: ["test"] },
    );

    const [r1, r2] = await Promise.all([
      tenantALS.run("beliandjolie", () => cache()),
      tenantALS.run("issyma", () => cache()),
    ]);

    expect(r1).toBe("beliandjolie");
    expect(r2).toBe("issyma");
    expect(bjCalls).toEqual(["beliandjolie"]);
    expect(issymaCalls).toEqual(["issyma"]);
  });
});
