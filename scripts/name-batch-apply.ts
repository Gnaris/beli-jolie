/**
 * Applique les choix validés en BDD + PFS + Ankorstore (un par un).
 * Met à jour le journal data/name-review-log.json.
 *
 * Usage : npx tsx scripts/name-batch-apply.ts <chemin-vers-payload.json>
 *
 * Le payload JSON est de la forme :
 * {
 *   "syncMarketplaces": true,
 *   "items": [
 *     { "ref": "A382", "name": "...", "description": "..." },
 *     ...
 *   ]
 * }
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { pfsUpdateProductInPlace } from "@/lib/pfs-update";
import { ankorstoreKickoffUpdate } from "@/lib/ankorstore-update";
import { autoTranslateProduct } from "@/lib/auto-translate";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
} from "@/lib/ankorstore-auth";

const JOURNAL_PATH = path.join(process.cwd(), "data", "name-review-log.json");
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const ANKORSTORE_DELAY_MS = 15000;

async function bootstrapAnkorstoreAuth(): Promise<boolean> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) return false;
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) return false;
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) return false;
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
  return true;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJournal(): { version: number; updated_at: string; products: Record<string, any> } {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
  } catch {
    return { version: 1, updated_at: new Date().toISOString(), products: {} };
  }
}

function writeJournal(j: any) {
  fs.mkdirSync(path.dirname(JOURNAL_PATH), { recursive: true });
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(j, null, 2));
}

type Item = { ref: string; name: string; description: string };

(async () => {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: npx tsx scripts/name-batch-apply.ts <payload.json>");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8")) as {
    syncMarketplaces?: boolean;
    items: Item[];
  };
  const syncMarketplaces = payload.syncMarketplaces !== false;
  const items = payload.items;

  console.log(`📋 ${items.length} produit(s) à appliquer. Marketplaces: ${syncMarketplaces}`);

  const ankorstoreReady = syncMarketplaces ? await bootstrapAnkorstoreAuth() : false;
  if (syncMarketplaces && !ankorstoreReady) {
    console.warn("⚠️  Auth Ankorstore KO — Ankorstore sera ignoré.");
  }

  const journal = readJournal();
  const reports: any[] = [];

  for (const it of items) {
    const r: any = { ref: it.ref };
    try {
      const product = await prisma.product.findUnique({
        where: { reference: it.ref },
        select: { id: true, pfsProductId: true, ankorsProductId: true },
      });
      if (!product) {
        r.error = "produit introuvable";
        reports.push(r);
        continue;
      }

      // 1. BDD
      await prisma.product.update({
        where: { id: product.id },
        data: { name: it.name, description: it.description },
      });
      r.bdd = "ok";

      // 2. Reset translations
      const del = await prisma.productTranslation.deleteMany({ where: { productId: product.id } });
      r.translations_deleted = del.count;

      // 3. Trigger DeepL retranslation (fire-and-forget)
      autoTranslateProduct(product.id, it.name, it.description, []);

      // 4. PFS
      r.pfs = "skip";
      if (syncMarketplaces && product.pfsProductId) {
        try {
          const res = await pfsUpdateProductInPlace(product.id, undefined, {
            skipRevalidation: true,
          });
          r.pfs = res.success ? "ok" : `error: ${res.error ?? "?"}`;
        } catch (e: any) {
          r.pfs = `exception: ${e?.message ?? String(e)}`;
        }
      }

      // 5. Ankorstore (one at a time with delay)
      r.ankorstore = "skip";
      if (syncMarketplaces && product.ankorsProductId && ankorstoreReady) {
        try {
          const res = await ankorstoreKickoffUpdate(product.id, { skipRevalidation: true });
          r.ankorstore = res.success ? "ok" : `error: ${(res as any).error ?? "?"}`;
        } catch (e: any) {
          r.ankorstore = `exception: ${e?.message ?? String(e)}`;
        }
      }

      // 6. Update journal
      journal.products[it.ref] = {
        status: "validated",
        name: it.name,
        description: it.description,
        applied_at: new Date().toISOString(),
        marketplaces: { pfs: r.pfs, ankorstore: r.ankorstore },
      };
    } catch (e: any) {
      r.error = e?.message ?? String(e);
    }

    reports.push(r);
    console.log(`  ${it.ref} → BDD:${r.bdd ?? "-"} PFS:${(r.pfs || "-").slice(0, 30)} Ankorstore:${(r.ankorstore || "-").slice(0, 30)}`);

    // Délai entre les opérations Ankorstore pour éviter les 403
    if (syncMarketplaces && r.ankorstore && r.ankorstore.startsWith("ok")) {
      await sleep(ANKORSTORE_DELAY_MS);
    }
  }

  journal.updated_at = new Date().toISOString();
  writeJournal(journal);

  console.log("\n=== RAPPORT ===");
  console.log(JSON.stringify(reports, null, 2));
  console.log(`\n📒 Journal mis à jour. Total produits suivis : ${Object.keys(journal.products).length}`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
