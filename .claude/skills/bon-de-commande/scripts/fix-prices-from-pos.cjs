#!/usr/bin/env node
/**
 * Corrige les prix unitaires en BDD prod pour les produits importés
 * avec un mauvais prix (= prix de la colonne 单价/价格 au lieu du prix
 * vrai codé dans la dernière partie de la référence).
 *
 * Usage : node fix-prices-from-pos.cjs <bon1.xlsx> <bon2.xlsx> …
 *
 * Étapes :
 *  1. Pour chaque bon : parse via parse-po.cjs (qui renvoie déjà les vrais
 *     prix dans price car la règle vient d'être corrigée 2026-06-12).
 *  2. Construit un mapping { reference: priceCorrect }.
 *  3. Envoie un JSON au VPS prod.
 *  4. Lance via SSH un script Prisma qui met à jour productColor.unitPrice
 *     pour chaque produit/couleur.
 *
 * Tous les produits importés étant en OFFLINE (brouillon), pas besoin de
 * resync marketplace.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VPS = "root@72.61.106.128";
const PARSER = path.join(__dirname, "parse-po.cjs");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) {
    console.error(`[${cmd}] échec :`, r.stderr || "code " + r.status);
    process.exit(r.status || 1);
  }
  return r.stdout;
}

const xlsxFiles = process.argv.slice(2);
if (xlsxFiles.length === 0) {
  console.error("Usage : node fix-prices-from-pos.cjs <bon1.xlsx> [bon2.xlsx] …");
  process.exit(1);
}

const priceByRef = {};
for (const file of xlsxFiles) {
  if (!fs.existsSync(file)) {
    console.warn(`⚠ Fichier introuvable : ${file}`);
    continue;
  }
  console.log(`→ Parsing ${path.basename(file)}…`);
  const out = run("node", [PARSER, file]);
  const j = JSON.parse(out);
  if (j.error) {
    console.warn(`  ⚠ Erreur de parsing : ${j.error}`);
    continue;
  }
  // Le price (déjà corrigé via extractPriceFromRef) est le même pour toutes les
  // couleurs d'un produit. On prend la première variant.
  for (const p of j.products) {
    if (p.colors.length && p.colors[0].price != null) {
      priceByRef[p.reference] = p.colors[0].price;
    }
  }
  // Inclure aussi les 返单 (déjà sur le site et importés) car leur prix
  // peut aussi avoir été mis à jour par erreur via les fichiers précédents.
  for (const p of (j.fandan || [])) {
    // Calcul direct depuis fullRef pour fandan car colors n'a pas de price
    const parts = String(p.fullRef).split("-");
    const last = parts[parts.length - 1].replace(/[^\d.]/g, "");
    const n = parseFloat(last);
    if (Number.isFinite(n)) priceByRef[p.reference] = n / 100;
  }
}

console.log(`\nTotal références à mettre à jour : ${Object.keys(priceByRef).length}`);
if (Object.keys(priceByRef).length === 0) {
  console.error("Aucune référence à corriger.");
  process.exit(0);
}

// Envoyer au VPS
const tmpPath = path.join(process.env.TEMP || "/tmp", "fix-prices.json");
fs.writeFileSync(tmpPath, JSON.stringify(priceByRef, null, 2), "utf-8");
console.log(`Envoi sur le VPS…`);
run("scp", ["-q", tmpPath, `${VPS}:/tmp/fix-prices.json`]);

// Script de mise à jour à exécuter sur le VPS
const updateScript = `
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const p = new PrismaClient();
(async () => {
  const map = JSON.parse(fs.readFileSync("/tmp/fix-prices.json", "utf-8"));
  const refs = Object.keys(map);
  // ⚠️ On ne touche QUE aux produits en statut OFFLINE (brouillon, fraîchement
  // importés). Ceux déjà ONLINE / ARCHIVED ont leur prix géré côté site et ne
  // doivent pas être écrasés.
  const products = await p.product.findMany({
    where: { reference: { in: refs }, status: "OFFLINE" },
    select: {
      id: true,
      reference: true,
      status: true,
      colors: {
        select: {
          id: true,
          unitPrice: true,
          color: { select: { name: true } },
          variantSizes: { select: { id: true, pricePerUnit: true } },
        }
      }
    }
  });
  console.log("Produits trouvés en BDD :", products.length, "/", refs.length);
  let touched = 0;
  let untouched = 0;
  let skipped = 0;
  const log = [];
  for (const prod of products) {
    const newPrice = map[prod.reference];
    if (newPrice == null) { skipped++; continue; }
    for (const pc of prod.colors) {
      // Mise à jour de productColor.unitPrice
      const oldUnit = Number(pc.unitPrice);
      if (oldUnit !== newPrice) {
        await p.productColor.update({
          where: { id: pc.id },
          data: { unitPrice: newPrice }
        });
        log.push(prod.reference + " (" + pc.color.name + ") : " + oldUnit + "€ → " + newPrice + "€");
        touched++;
      } else {
        untouched++;
      }
      // Mise à jour des variantSizes (UNIT et PACK)
      for (const vs of pc.variantSizes) {
        const oldVS = Number(vs.pricePerUnit);
        if (oldVS !== newPrice) {
          await p.variantSize.update({
            where: { id: vs.id },
            data: { pricePerUnit: newPrice }
          });
        }
      }
    }
  }
  console.log("Couleurs mises à jour :", touched);
  console.log("Couleurs déjà correctes :", untouched);
  console.log("Produits sans correspondance :", skipped);
  console.log();
  console.log("Détail des corrections :");
  log.forEach(l => console.log("  -", l));
  await p.\$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
`;
fs.writeFileSync(tmpPath + ".script.cjs", updateScript, "utf-8");
// Le script doit être DANS le dossier projet pour que require('@prisma/client') marche
run("scp", ["-q", tmpPath + ".script.cjs", `${VPS}:/var/www/beliandjolie/fix-prices-tmp.cjs`]);

console.log("Exécution sur le VPS…\n");
const out = run("ssh", [VPS, "cd /var/www/beliandjolie && node fix-prices-tmp.cjs && rm fix-prices-tmp.cjs"]);
process.stdout.write(out);
