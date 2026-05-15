/**
 * Restaure les ankorsProductId / ankorsVariantId en BDD pour une liste de
 * references produit, via matching auto depuis l'API Ankorstore.
 *
 * SANS kickoff overwrite — on se contente d'écrire les IDs côté nous.
 *
 * Usage :
 *   npx tsx scripts/restore-ankorstore-links.ts <fichier.txt>            # applique
 *   npx tsx scripts/restore-ankorstore-links.ts <fichier.txt> --dry-run  # simulation
 */
import "dotenv/config";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import {
  ankorstoreListAllProducts,
  type AnkorstoreProduct,
} from "@/lib/ankorstore-api";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";
import { runAutoMatch, type BjProductForMatch } from "@/lib/ankorstore-match";
import { autoLinkAnkorstoreVariants } from "@/lib/ankorstore-variant-link";
import { buildMatchedRows, splitAmbiguousAkSide } from "@/scripts/link-ankorstore-bulk";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function bootstrapAnkorstoreAuth(): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("Identifiants Ankorstore manquants");
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("Usage : npx tsx scripts/restore-ankorstore-links.ts <fichier.txt> [--dry-run]");
    process.exit(1);
  }

  const refs = Array.from(
    new Set(
      fs
        .readFileSync(fileArg, "utf-8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    ),
  );
  console.log(`${refs.length} references a restaurer (mode : ${dryRun ? "DRY-RUN" : "APPLY"})`);

  await bootstrapAnkorstoreAuth();

  const bjRows = await prisma.product.findMany({
    where: {
      reference: { in: refs },
      status: { not: "ARCHIVED" },
      ankorsProductId: null,
    },
    select: {
      id: true,
      reference: true,
      name: true,
      colors: {
        select: { colorId: true, color: { select: { name: true } } },
      },
    },
  });
  console.log(`  - eligibles BDD (sans lien actuel) : ${bjRows.length}`);
  if (bjRows.length === 0) {
    console.log("Rien a faire.");
    return;
  }

  const bjForMatch: BjProductForMatch[] = bjRows.map((p) => ({
    id: p.id,
    name: p.name,
    reference: p.reference,
    colors: p.colors
      .filter((c) => c.colorId && c.color)
      .map((c) => ({ id: c.colorId as string, name: c.color!.name })),
  }));

  console.log("  - recuperation du catalogue Ankorstore (paginated)...");
  const akAll: AnkorstoreProduct[] = await ankorstoreListAllProducts({
    onPage: (_, idx, total) => {
      if ((idx + 1) % 10 === 0) console.log(`    page ${idx + 1} → ${total} produits cumules`);
    },
  });
  const akActive = akAll.filter((p) => !p.archived);
  console.log(`  - catalogue : ${akActive.length} produits actifs (${akAll.length - akActive.length} archives ignores)`);

  const report = runAutoMatch(bjForMatch, akActive);
  console.log(`  - matched   : ${report.matched}`);
  console.log(`  - ambiguous : ${report.ambiguous}`);
  console.log(`  - unmatched : ${report.unmatched}`);

  const allRows = buildMatchedRows(report.results);
  const { safe, ambiguousAk } = splitAmbiguousAkSide(allRows);
  console.log(`  - liens surs (1 candidat AS) : ${safe.length}`);
  console.log(`  - bjId avec plusieurs AS    : ${ambiguousAk.length}`);

  if (dryRun) {
    console.log("\n--- 20 premiers liens surs ---");
    for (const r of safe.slice(0, 20)) {
      console.log(`  ${r.bjReference.padEnd(14)}  →  ${r.akId}`);
    }
    return;
  }

  let okCount = 0;
  let errCount = 0;
  const errors: { ref: string; error: string }[] = [];
  for (const r of safe) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: r.bjId },
          data: { ankorsProductId: r.akId },
        });
        await tx.productColor.updateMany({
          where: { productId: r.bjId },
          data: { ankorsVariantId: null },
        });
        for (const v of r.variantPairs) {
          await tx.productColor.updateMany({
            where: { productId: r.bjId, colorId: v.localColorId, saleType: "UNIT" },
            data: { ankorsVariantId: v.ankorstoreVariantId },
          });
        }
      });
      try {
        await autoLinkAnkorstoreVariants(r.bjId);
      } catch {
        // best effort
      }
      okCount++;
      process.stdout.write(`  OK   ${r.bjReference}\n`);
    } catch (err) {
      errCount++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ ref: r.bjReference, error: msg });
      process.stdout.write(`  KO   ${r.bjReference}  ${msg}\n`);
    }
  }

  console.log(`\n--- Resume ---`);
  console.log(`Liens restaures : ${okCount}`);
  console.log(`Echecs          : ${errCount}`);
  console.log(`Sans match      : ${report.unmatched}`);
  console.log(`Ambigus AS      : ${ambiguousAk.length}`);

  fs.writeFileSync(
    "/var/log/ankorstore-restore-summary.json",
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        eligibleBdd: bjRows.length,
        matched: report.matched,
        ambiguous: report.ambiguous,
        unmatched: report.unmatched,
        ambiguousAkCount: ambiguousAk.length,
        okCount,
        errCount,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`Resume final : /var/log/ankorstore-restore-summary.json`);
}

main()
  .catch((err) => {
    console.error("Echec du script :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
