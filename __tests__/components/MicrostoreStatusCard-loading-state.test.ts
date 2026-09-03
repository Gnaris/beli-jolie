import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vérifie que la carte Microstore vire bleu « En cours » pendant une liaison
// (LinkMicrostoreProductModal → enqueueLinkJob dans MarketplaceLinkContext) et
// pendant un envoi (handlePush → enqueue dans MarketplaceRefreshQueue).
// Bug rapporté par la cliente : sans le hook `useMarketplaceLinkJobs`, la
// carte restait sur son état précédent puis basculait vert d'un coup à la fin.
const SRC = readFileSync(
  resolve(
    __dirname,
    "../../components/admin/products/MicrostoreStatusCard.tsx",
  ),
  "utf8",
);

describe("MicrostoreStatusCard — état bleu « En cours »", () => {
  it("importe useMarketplaceLinkJobs pour détecter une liaison en cours", () => {
    expect(SRC).toMatch(
      /from "@\/components\/admin\/products\/MarketplaceLinkContext"/,
    );
    expect(SRC).toMatch(/import\s*\{\s*useMarketplaceLinkJobs\s*\}/);
  });

  it("dérive `linking` depuis hasLinkJob(productId, \"microstore\")", () => {
    expect(SRC).toMatch(/hasActiveJobForProduct:\s*hasLinkJob/);
    expect(SRC).toMatch(/linking\s*=\s*hasLinkJob\(\s*productId,\s*"microstore"\s*\)/);
  });

  it("`busy` combine push (inFlight) ET liaison (linking)", () => {
    expect(SRC).toMatch(/const\s+busy\s*=\s*inFlight\s*\|\|\s*linking/);
  });

  it("applique la classe bleue mp-loading-card quand busy=true", () => {
    // Fond bleu indigo — mêmes tokens que les autres MarketplaceCard.
    expect(SRC).toMatch(/mp-loading-card\s+bg-\[#EEF2FF\]\s+border-\[#C7D2FE\]/);
    expect(SRC).toMatch(/mp-loading-text\s+text-\[#4F46E5\]/);
    expect(SRC).toMatch(/mp-loading-divide\s+border-\[#C7D2FE\]/);
  });

  it("le bleu passe AVANT online/syncRequired (bleu prime sur vert et orange)", () => {
    // On veut voir apparaître `busy ? mp-loading… : syncRequired ? … : online ?`
    // dans cet ordre dans le fichier — l'ordre des ternaires détermine la priorité.
    const idxLoading = SRC.indexOf("mp-loading-card");
    const idxOnline = SRC.indexOf("mp-online-card");
    const idxSync = SRC.indexOf("sync-required-card");
    expect(idxLoading).toBeGreaterThan(-1);
    expect(idxLoading).toBeLessThan(idxSync);
    expect(idxLoading).toBeLessThan(idxOnline);
  });

  it("libellé header distingue liaison (« Liaison… ») et envoi (« Envoi Microstore… »)", () => {
    expect(SRC).toMatch(/linking \? "Liaison…" : "Envoi Microstore…"/);
  });

  it("title tooltip distingue liaison et envoi", () => {
    expect(SRC).toMatch(/"Liaison Microstore en cours…"/);
    expect(SRC).toMatch(/"Envoi Microstore en cours…"/);
  });
});
