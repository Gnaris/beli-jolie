/**
 * Relance les brouillons Ankorstore à partir d'un export CSV.
 *
 * Pour chaque référence SKU trouvée dans le CSV :
 *   - Cherche le produit en BDD (par `Product.reference` = préfixe avant le 1er `_`)
 *   - Exclut les produits ARCHIVED, les orphelins (absents BDD)
 *   - Exclut les produits avec une opération PENDING récente (< 30 min)
 *   - Si `ankorsProductId` NULL → kickoff PUBLISH (nouveau produit)
 *   - Sinon                    → kickoff REFRESH (création + archivage ancien)
 *
 * Modes :
 *   --dry-run (défaut) : simulation, n'envoie rien
 *   --apply            : envoie réellement
 *   --limit N          : ne traite que les N premiers (vague de test)
 *   --shuffle          : mélange aléatoirement avant limit (échantillon représentatif)
 *
 * Usage :
 *   npx tsx scripts/ankorstore-relaunch-from-csv.ts /tmp/drafts-export.csv
 *   npx tsx scripts/ankorstore-relaunch-from-csv.ts /tmp/drafts-export.csv --limit 20 --shuffle --apply
 */
import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
} from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { ankorstoreKickoffPublish } from "@/lib/ankorstore-publish";
import { ankorstoreKickoffRefresh } from "@/lib/ankorstore-refresh";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const CONCURRENCY = 2;
const DELAY_MS = 400;

async function bootstrapAnkorstoreAuth(): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) {
    throw new Error("Identifiants Ankorstore manquants.");
  }
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
  if (!resp.ok) throw new Error(`OAuth Ankorstore HTTP ${resp.status}`);
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("Réponse OAuth invalide");
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
}

function parseCsvRefs(content: string): Set<string> {
  const refs = new Set<string>();
  let i = 0;
  const len = content.length;
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let rowIdx = 0;

  function pushField() { fields.push(current); current = ""; }
  function pushRow() {
    if (fields.length === 0 && current === "") return;
    pushField();
    if (rowIdx > 0 && fields.length >= 1) {
      const sku = fields[0].trim();
      const idx = sku.indexOf("_");
      const ref = idx > 0 ? sku.slice(0, idx).trim() : sku.trim();
      if (ref) refs.add(ref);
    }
    rowIdx++;
    fields = [];
  }

  while (i < len) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { current += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      current += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { pushField(); i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { pushRow(); i++; continue; }
    current += ch; i++;
  }
  pushRow();
  return refs;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function processInBatches<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let cursor = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i]);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => pump()));
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const doShuffle = args.includes("--shuffle");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

  if (!csvPath) throw new Error("Usage : <csv> [--limit=N] [--shuffle] [--apply]");
  if (!fs.existsSync(csvPath)) throw new Error(`Fichier introuvable : ${csvPath}`);

  console.log(`[Relaunch from CSV] Mode : ${apply ? "APPLY (envoi réel)" : "DRY-RUN"}`);
  if (Number.isFinite(limit)) console.log(`Limite : ${limit} produits`);
  if (doShuffle) console.log(`Mélange : oui (échantillon aléatoire)`);
  console.log();

  const refsFromCsv = parseCsvRefs(fs.readFileSync(csvPath, "utf-8"));
  console.log(`Refs uniques dans le CSV : ${refsFromCsv.size}`);

  const refsArray = Array.from(refsFromCsv);
  const products = await prisma.product.findMany({
    where: {
      reference: { in: refsArray },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      reference: true,
      name: true,
      ankorsProductId: true,
      status: true,
    },
  });
  console.log(`Refs présentes en BDD (non archivées) : ${products.length}`);

  // Exclut les produits avec opération PENDING récente
  const inflightOps = await prisma.ankorstoreOperation.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      status: "PENDING",
      type: { in: ["PUBLISH", "REFRESH_DELETE_OLD", "REFRESH_CREATE_NEW"] },
      createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
    },
    select: { productId: true },
  });
  const inflightSet = new Set(inflightOps.map((o) => o.productId));
  const eligibles = products.filter((p) => !inflightSet.has(p.id));
  console.log(`Éligibles (hors opération en cours) : ${eligibles.length}`);

  const selection = doShuffle ? shuffle(eligibles) : eligibles;
  const toProcess = selection.slice(0, Math.min(limit, selection.length));

  const breakdown = { PUBLISH: 0, REFRESH: 0 };
  for (const p of toProcess) {
    if (p.ankorsProductId) breakdown.REFRESH++;
    else breakdown.PUBLISH++;
  }

  console.log(`\nÀ traiter : ${toProcess.length}`);
  console.log(`  PUBLISH : ${breakdown.PUBLISH}`);
  console.log(`  REFRESH : ${breakdown.REFRESH}`);
  console.log();

  if (!apply) {
    console.log("--- Aperçu (10 premiers) ---");
    for (const p of toProcess.slice(0, 10)) {
      const action = p.ankorsProductId ? "REFRESH" : "PUBLISH";
      console.log(`  ${action.padEnd(8)} ${p.reference.padEnd(14)} ${p.name.slice(0, 50)}`);
    }
    console.log(`\nDry-run : aucune requête envoyée. Ajoutez --apply pour exécuter.`);
    return;
  }

  // APPLY
  const startedAt = Date.now();
  let okCount = 0;
  let errCount = 0;
  const errors: { ref: string; action: string; error: string }[] = [];

  await processInBatches(
    toProcess,
    async (p) => {
      const action = p.ankorsProductId ? "REFRESH" : "PUBLISH";
      try {
        const r = action === "PUBLISH"
          ? await ankorstoreKickoffPublish(p.id)
          : await ankorstoreKickoffRefresh(p.id);

        if (r.success) {
          okCount++;
          process.stdout.write(`  OK   ${action.padEnd(8)} ${p.reference.padEnd(14)} ${p.name.slice(0, 40)}\n`);
        } else {
          errCount++;
          errors.push({ ref: p.reference, action, error: r.error ?? "?" });
          process.stdout.write(`  KO   ${action.padEnd(8)} ${p.reference.padEnd(14)} ${(r.error ?? "?").slice(0, 60)}\n`);
        }
      } catch (err) {
        errCount++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ ref: p.reference, action, error: msg });
        process.stdout.write(`  KO   ${action.padEnd(8)} ${p.reference.padEnd(14)} ${msg.slice(0, 60)}\n`);
      }
    },
    CONCURRENCY,
  );

  const dur = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n--- Résumé ---`);
  console.log(`Produits traités : ${toProcess.length}`);
  console.log(`Kickoffs OK      : ${okCount}`);
  console.log(`Kickoffs KO      : ${errCount}`);
  console.log(`Durée            : ${dur}s`);

  const summaryPath = `/var/log/ankorstore-relaunch-csv-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.json`;
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ finishedAt: new Date().toISOString(), total: toProcess.length, okCount, errCount, errors }, null, 2),
  );
  console.log(`Résumé : ${summaryPath}`);
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
