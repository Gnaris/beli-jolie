/**
 * Supprime les 2 brouillons de test créés le 2026-06-12 pendant la mise en
 * place du chantier Faire (validation des appels API en réel).
 *
 *   p_5tsjg6ymeh — Bracelet test
 *   p_hhgemv97cu — T-shirt test 3 couleurs
 *
 * À usage one-shot. Conserve le fichier pour traçabilité.
 *
 *   npx tsx scripts/faire-delete-test-drafts.ts
 */

import { config } from "dotenv";
config();

import { FAIRE_BASE_URL, getFaireApiKey } from "@/lib/faire-auth";

const TEST_DRAFT_IDS = ["p_5tsjg6ymeh", "p_hhgemv97cu"];

async function main() {
  const key = await getFaireApiKey();
  if (!key) {
    console.error("Clé API Faire absente dans SiteConfig.");
    process.exit(1);
  }

  for (const id of TEST_DRAFT_IDS) {
    const res = await fetch(`${FAIRE_BASE_URL}/products/${id}`, {
      method: "DELETE",
      headers: {
        "X-FAIRE-ACCESS-TOKEN": key,
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; BeliJolie/1.0; +https://beliandjolie.com)",
      },
    });

    if (res.ok || res.status === 404) {
      console.log(`[OK]   ${id} → HTTP ${res.status}`);
    } else {
      const body = await res.text().catch(() => "");
      console.error(`[FAIL] ${id} → HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
