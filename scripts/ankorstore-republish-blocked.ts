/**
 * Délie + republie les produits bloqués par une operation Ankorstore PENDING
 * fantôme (erreur 403 « Status of the operation cannot be updated from
 * [pending] to [started] »).
 *
 * Lit le résumé /var/log/ankorstore-repush-summary.json (produit par le script
 * push-ankorstore-fixed.ts), filtre les échecs « pending_blocked », pour chacun :
 *   1. Efface ankorsProductId / ankorsVariantId / ankorsLastSyncSnapshot en BDD
 *   2. Lance ankorstoreKickoffPublish → nouveau produit côté Ankorstore
 *
 * Les anciens drafts restent visibles dans leur backoffice — impossible à
 * supprimer côté nous tant qu'ils sont bloqués chez eux.
 *
 * Usage :
 *   npx tsx scripts/ankorstore-republish-blocked.ts            # applique
 *   npx tsx scripts/ankorstore-republish-blocked.ts --dry-run  # simulation
 */
import "dotenv/config";
import fs from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { ankorstoreKickoffPublish } from "@/lib/ankorstore-publish";

const SUMMARY_PATH = "/var/log/ankorstore-repush-summary.json";
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
  if (!resp.ok) throw new Error(`OAuth Ankorstore HTTP ${resp.status}`);
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("Reponse OAuth invalide");
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
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(SUMMARY_PATH)) {
    throw new Error(`Resume introuvable : ${SUMMARY_PATH}`);
  }
  const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8")) as {
    errors: { ref: string; error: string }[];
  };

  const blockedRefs = Array.from(
    new Set(
      summary.errors
        .filter((e) => e.error.includes("cannot be updated from [pending]"))
        .map((e) => e.ref.toUpperCase()),
    ),
  );
  console.log(
    `${blockedRefs.length} references avec opération fantôme à délier+republier (mode : ${dryRun ? "DRY-RUN" : "APPLY"})`,
  );

  if (blockedRefs.length === 0) {
    console.log("Rien a faire.");
    return;
  }

  await bootstrapAnkorstoreAuth();

  const products = await prisma.product.findMany({
    where: {
      reference: { in: blockedRefs },
      status: { not: "ARCHIVED" },
    },
    select: { id: true, reference: true, name: true, ankorsProductId: true },
  });

  console.log(`  - eligibles en BDD : ${products.length}`);

  if (dryRun) {
    console.log("\n--- 20 premiers ---");
    for (const p of products.slice(0, 20)) {
      console.log(`  ${p.reference.padEnd(14)} ankors=${p.ankorsProductId ?? "(null)"}  ${p.name.slice(0, 40)}`);
    }
    return;
  }

  let okCount = 0;
  let errCount = 0;
  const errors: { ref: string; error: string }[] = [];
  const startedAt = Date.now();

  await processInBatches(
    products,
    async (p) => {
      try {
        // Étape 1 : effacer les liens en BDD (dans une transaction)
        await prisma.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: p.id },
            data: {
              ankorsProductId: null,
              ankorsLastSyncSnapshot: Prisma.DbNull,
            },
          });
          await tx.productColor.updateMany({
            where: { productId: p.id },
            data: { ankorsVariantId: null },
          });
        });

        // Étape 2 : kickoff publish (création nouveau produit Ankorstore)
        const r = await ankorstoreKickoffPublish(p.id);
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
  console.log(`Refs traitees : ${products.length}`);
  console.log(`OK            : ${okCount}`);
  console.log(`Echecs        : ${errCount}`);
  console.log(`Duree         : ${dur}s`);

  fs.writeFileSync(
    "/var/log/ankorstore-republish-summary.json",
    JSON.stringify(
      { finishedAt: new Date().toISOString(), total: products.length, okCount, errCount, errors },
      null,
      2,
    ),
  );
  console.log(`Resume final : /var/log/ankorstore-republish-summary.json`);
}

main()
  .catch((err) => {
    console.error("Echec du script :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
