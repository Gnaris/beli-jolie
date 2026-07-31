import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Bug corrigé : après validation du shooting eFashion, les jobs
// MarketplaceRefreshJob EFASHION sont créés en base avec status=IN_PROGRESS,
// mais le context marketplace côté client ne les découvre qu'au prochain tick
// de polling (jusqu'à 10 s en idle). Pendant cette fenêtre :
//   (1) le badge marketplace repasse en rouge « hors ligne » car le state
//       client ne voit aucun job en cours (loading=false + serverProductId
//       encore absent pour un PUBLISH) ;
//   (2) le bouton « Publier » redevient cliquable et un double-clic
//       déclenche un second push concurrent.
//
// Le fix consiste à forcer un poll immédiat de la queue marketplace après
// un commit shooting réussi (via une méthode `refetch` exposée par
// MarketplaceRefreshContext).

const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/EfashionShootingBatchContext.tsx",
  ),
  "utf8",
);

describe("EfashionShootingBatchContext — refetch de la queue marketplace après commit", () => {
  it("importe useMarketplaceRefreshQueue depuis le context voisin", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*useMarketplaceRefreshQueue\s*\}\s*from\s*["']\.\/MarketplaceRefreshContext["']/,
    );
  });

  it("consomme le context marketplace dans le provider", () => {
    expect(SRC).toMatch(
      /const\s+marketplaceQueue\s*=\s*useMarketplaceRefreshQueue\(\)/,
    );
  });

  it("appelle marketplaceQueue.refetch() dans le finally du commit()", () => {
    // Extrait la fonction commit (du "const commit = useCallback" jusqu'au
    // "}, [" de fin — les deps du useCallback).
    const start = SRC.indexOf("const commit = useCallback");
    expect(start).toBeGreaterThan(0);
    const tail = SRC.slice(start);
    const end = tail.indexOf("}, [");
    expect(end).toBeGreaterThan(0);
    const commitBlock = tail.slice(0, end);
    expect(commitBlock).toMatch(/marketplaceQueue\.refetch\(\)/);
    // Doit être dans le finally, pas dans le try (pour couvrir aussi les
    // erreurs réseau — on veut réconcilier même si le fetch a jeté).
    const finallyIdx = commitBlock.lastIndexOf("finally");
    const refetchIdx = commitBlock.indexOf("marketplaceQueue.refetch()");
    expect(finallyIdx).toBeGreaterThan(0);
    expect(refetchIdx).toBeGreaterThan(finallyIdx);
  });

  it("marketplaceQueue est déclaré dans les deps du useCallback commit", () => {
    const start = SRC.indexOf("const commit = useCallback");
    const tail = SRC.slice(start);
    const depsMatch = tail.match(/\},\s*\[([^\]]*)\]/);
    expect(depsMatch).toBeTruthy();
    expect(depsMatch![1]).toMatch(/marketplaceQueue/);
  });
});

const CTX_SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MarketplaceRefreshContext.tsx",
  ),
  "utf8",
);

describe("MarketplaceRefreshContext — expose refetch() sur la valeur du context", () => {
  it("déclare refetch dans l'interface publique du context", () => {
    expect(CTX_SRC).toMatch(/refetch:\s*\(\)\s*=>\s*Promise<void>/);
  });

  it("branche refetch sur pollOnce dans la valeur exposée", () => {
    expect(CTX_SRC).toMatch(/refetch:\s*pollOnce/);
  });
});
