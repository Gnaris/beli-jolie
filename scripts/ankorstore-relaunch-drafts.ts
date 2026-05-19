/**
 * Relance les brouillons Ankorstore.
 *
 * Pour chaque produit qui a au moins une opération Ankorstore terminée en
 * échec (FAILED / PARTIALLY_FAILED) et qui n'a pas de nouvelle opération
 * réussie depuis :
 *   - Si `ankorsProductId` est NULL  → kickoff PUBLISH (création nouveau)
 *   - Si `ankorsProductId` existe    → kickoff REFRESH (création + archivage)
 *
 * Les produits ARCHIVED localement sont exclus.
 * Les produits sans variantes / sans images valides sont exclus (le build
 * d'input échouera de toute façon).
 *
 * Modes :
 *   --dry-run  (par défaut) : simulation, ne touche à rien
 *   --apply                 : envoie réellement les kickoffs à Ankorstore
 *
 * Le kickoff est asynchrone (mode callback-only) : Ankorstore valide en
 * arrière-plan, les webhooks finalisent. Ce script ne fait QUE déclencher.
 *
 * Usage (sur le VPS) :
 *   npx tsx scripts/ankorstore-relaunch-drafts.ts            # simulation
 *   npx tsx scripts/ankorstore-relaunch-drafts.ts --apply    # exécution
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
const CONCURRENCY = 2; // doux sur l'API Ankorstore
const DELAY_MS = 300; // entre 2 kickoffs

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
    throw new Error(
      "Identifiants Ankorstore manquants — Admin > Paramètres > Marketplaces.",
    );
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

type Candidate = {
  productId: string;
  reference: string;
  name: string;
  ankorsProductId: string | null;
  productStatus: string;
  hasInflight: boolean;
  failedSince: Date;
  action: "PUBLISH" | "REFRESH" | "SKIP_INFLIGHT" | "SKIP_RECENT_SUCCESS";
};

async function loadCandidates(): Promise<Candidate[]> {
  // 1) Tous les productId qui ont au moins 1 opération FAILED/PARTIALLY_FAILED
  //    sur les types qui créent un brouillon (PUBLISH, REFRESH_CREATE_NEW, UPDATE)
  const failedOps = await prisma.ankorstoreOperation.findMany({
    where: {
      status: { in: ["FAILED", "PARTIALLY_FAILED"] },
      type: { in: ["PUBLISH", "REFRESH_CREATE_NEW", "UPDATE"] },
    },
    select: {
      productId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Dédoublonne par productId, garde la plus récente date d'échec
  const failedByProduct = new Map<string, Date>();
  for (const op of failedOps) {
    if (!failedByProduct.has(op.productId)) {
      failedByProduct.set(op.productId, op.createdAt);
    }
  }
  const productIds = Array.from(failedByProduct.keys());

  if (productIds.length === 0) return [];

  // 2) Charge les produits concernés (exclut ARCHIVED)
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
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

  // 3) Pour chacun, vérifie s'il y a une opération PENDING récente (in-flight)
  //    ou une opération SUCCESS plus récente que la dernière FAILED (déjà résolu)
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

  const successOps = await prisma.ankorstoreOperation.findMany({
    where: {
      productId: { in: products.map((p) => p.id) },
      status: "SUCCEEDED",
      type: { in: ["PUBLISH", "REFRESH_CREATE_NEW", "UPDATE"] },
    },
    select: { productId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const latestSuccessByProduct = new Map<string, Date>();
  for (const op of successOps) {
    if (!latestSuccessByProduct.has(op.productId)) {
      latestSuccessByProduct.set(op.productId, op.createdAt);
    }
  }

  // 4) Compose la liste finale
  const out: Candidate[] = [];
  for (const p of products) {
    const failedSince = failedByProduct.get(p.id)!;
    const lastSuccess = latestSuccessByProduct.get(p.id);

    let action: Candidate["action"];
    if (inflightSet.has(p.id)) {
      action = "SKIP_INFLIGHT";
    } else if (lastSuccess && lastSuccess > failedSince) {
      action = "SKIP_RECENT_SUCCESS";
    } else if (p.ankorsProductId) {
      action = "REFRESH";
    } else {
      action = "PUBLISH";
    }

    out.push({
      productId: p.id,
      reference: p.reference,
      name: p.name,
      ankorsProductId: p.ankorsProductId,
      productStatus: p.status,
      hasInflight: inflightSet.has(p.id),
      failedSince,
      action,
    });
  }

  return out.sort((a, b) => a.reference.localeCompare(b.reference));
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
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => pump()));
  return out;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log(
    `[Ankorstore Relaunch Drafts] Mode : ${dryRun ? "DRY-RUN (simulation)" : "APPLY (envoi réel)"}\n`,
  );

  await bootstrapAnkorstoreAuth();
  console.log("✓ Authentification Ankorstore OK\n");

  const candidates = await loadCandidates();

  // Récap par action
  const counts = {
    PUBLISH: 0,
    REFRESH: 0,
    SKIP_INFLIGHT: 0,
    SKIP_RECENT_SUCCESS: 0,
  };
  for (const c of candidates) counts[c.action]++;

  console.log(`Produits candidats : ${candidates.length}`);
  console.log(`  - PUBLISH (jamais publié) ............. ${counts.PUBLISH}`);
  console.log(`  - REFRESH (déjà sur Ankorstore) ....... ${counts.REFRESH}`);
  console.log(`  - SKIP (opération en cours) ........... ${counts.SKIP_INFLIGHT}`);
  console.log(`  - SKIP (succès récent depuis) ......... ${counts.SKIP_RECENT_SUCCESS}`);

  const toProcess = candidates.filter(
    (c) => c.action === "PUBLISH" || c.action === "REFRESH",
  );
  console.log(`\nÀ traiter effectivement : ${toProcess.length}\n`);

  if (dryRun) {
    console.log("--- Exemple : 20 premiers ---");
    for (const c of toProcess.slice(0, 20)) {
      console.log(
        `  ${c.action.padEnd(8)} ${c.reference.padEnd(14)} ${c.name.slice(0, 50)}`,
      );
    }
    console.log("\n(Aucune requête envoyée à Ankorstore.)");
    console.log("Pour exécuter : npx tsx scripts/ankorstore-relaunch-drafts.ts --apply");
    return;
  }

  // Mode APPLY
  if (toProcess.length === 0) {
    console.log("Rien à faire.");
    return;
  }

  console.log(`Lancement de ${toProcess.length} kickoffs (concurrence ${CONCURRENCY}, délai ${DELAY_MS}ms)...\n`);
  const startedAt = Date.now();
  let okCount = 0;
  let errCount = 0;
  const errors: { ref: string; action: string; error: string }[] = [];

  await processInBatches(
    toProcess,
    async (c) => {
      try {
        const result =
          c.action === "PUBLISH"
            ? await ankorstoreKickoffPublish(c.productId)
            : await ankorstoreKickoffRefresh(c.productId);

        if (result.success) {
          okCount++;
          process.stdout.write(
            `  OK   ${c.action.padEnd(8)} ${c.reference.padEnd(14)} ${c.name.slice(0, 40)}\n`,
          );
        } else {
          errCount++;
          errors.push({ ref: c.reference, action: c.action, error: result.error ?? "?" });
          process.stdout.write(
            `  KO   ${c.action.padEnd(8)} ${c.reference.padEnd(14)} ${(result.error ?? "?").slice(0, 60)}\n`,
          );
        }
      } catch (err) {
        errCount++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ ref: c.reference, action: c.action, error: msg });
        process.stdout.write(
          `  KO   ${c.action.padEnd(8)} ${c.reference.padEnd(14)} ${msg.slice(0, 60)}\n`,
        );
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

  const summaryPath = `/var/log/ankorstore-relaunch-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.json`;
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        total: toProcess.length,
        okCount,
        errCount,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`Résumé : ${summaryPath}`);
  console.log(
    `\nLes kickoffs sont partis — Ankorstore validera en arrière-plan et`,
  );
  console.log(
    `les webhooks finaliseront. Suivi temps réel dans la file en bas à droite`,
  );
  console.log(`du back-office, ou via le bouton « Rafraîchir » sur les fiches produit.`);
}

main()
  .catch((err) => {
    console.error("[Ankorstore Relaunch Drafts] Échec :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
