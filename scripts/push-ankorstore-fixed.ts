/**
 * Relance un push Ankorstore (kickoff overwrite) pour une liste de references
 * produit. Sert apres une correction (ex : agrandissement d'images) pour
 * renvoyer les produits a Ankorstore.
 *
 * Le fichier d'entree est un .txt avec une reference par ligne (insensible a
 * la casse). Les produits sans ankorsProductId sont ignores. Les produits
 * ARCHIVED sont aussi ignores.
 *
 * Usage :
 *   npx tsx scripts/push-ankorstore-fixed.ts <fichier.txt>            # applique
 *   npx tsx scripts/push-ankorstore-fixed.ts <fichier.txt> --dry-run  # simulation
 */

import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { ankorstoreKickoffUpdate } from "@/lib/ankorstore-update";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";
const CONCURRENCY = 3;

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
    throw new Error("Identifiants Ankorstore manquants — Admin > Parametres > Marketplaces.");
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
  if (!resp.ok) {
    throw new Error(`OAuth Ankorstore HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) {
    throw new Error("Reponse OAuth Ankorstore invalide");
  }
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
}

async function processInBatches<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => pump()));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("Usage : npx tsx scripts/push-ankorstore-fixed.ts <fichier.txt> [--dry-run]");
    process.exit(1);
  }

  const raw = fs.readFileSync(fileArg, "utf-8");
  const refs = Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    ),
  );
  console.log(`${refs.length} references a traiter (mode : ${dryRun ? "DRY-RUN" : "APPLY"})`);

  await bootstrapAnkorstoreAuth();

  const products = await prisma.product.findMany({
    where: {
      reference: { in: refs },
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
  const byRef = new Map(products.map((p) => [p.reference.toUpperCase(), p]));

  const missing: string[] = [];
  const noLink: string[] = [];
  const eligible: typeof products = [];
  for (const ref of refs) {
    const p = byRef.get(ref);
    if (!p) {
      missing.push(ref);
      continue;
    }
    if (!p.ankorsProductId) {
      noLink.push(ref);
      continue;
    }
    eligible.push(p);
  }

  console.log(`  - introuvables ou ARCHIVED : ${missing.length}`);
  console.log(`  - non lies a Ankorstore    : ${noLink.length}`);
  console.log(`  - a re-pusher              : ${eligible.length}`);
  if (eligible.length === 0) {
    console.log("\nRien a faire.");
    return;
  }

  if (dryRun) {
    console.log("\n--- Aperçu des 20 premieres refs ---");
    for (const p of eligible.slice(0, 20)) console.log(`  ${p.reference}  ${p.name}`);
    return;
  }

  let okCount = 0;
  let errCount = 0;
  const errors: { ref: string; error: string }[] = [];

  const startedAt = Date.now();
  await processInBatches(
    eligible,
    async (p) => {
      try {
        const r = await ankorstoreKickoffUpdate(p.id, {
          forceFullSync: true,
          skipRevalidation: true,
        });
        if (r.success) {
          okCount++;
          process.stdout.write(`  OK   ${p.reference.padEnd(14)} ${p.name.slice(0, 40)}\n`);
        } else {
          errCount++;
          errors.push({ ref: p.reference, error: r.error ?? "?" });
          process.stdout.write(`  KO   ${p.reference.padEnd(14)} ${r.error}\n`);
        }
      } catch (err) {
        errCount++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ ref: p.reference, error: msg });
        process.stdout.write(`  KO   ${p.reference.padEnd(14)} ${msg}\n`);
      }
    },
    CONCURRENCY,
  );

  const dur = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n--- Resume ---`);
  console.log(`Re-push lance pour : ${eligible.length} produits`);
  console.log(`OK                 : ${okCount}`);
  console.log(`Echecs             : ${errCount}`);
  console.log(`Duree              : ${dur}s`);

  const summary = {
    finishedAt: new Date().toISOString(),
    eligibleCount: eligible.length,
    okCount,
    errCount,
    missing,
    noLink,
    errors,
  };
  fs.writeFileSync("/var/log/ankorstore-repush-summary.json", JSON.stringify(summary, null, 2));
  console.log(`Resume final ecrit : /var/log/ankorstore-repush-summary.json`);
}

main()
  .catch((err) => {
    console.error("Echec du script :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
