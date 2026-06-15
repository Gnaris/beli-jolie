/**
 * Aspire la documentation officielle Faire (developers.faire.com/docs) en
 * pilotant Chromium via Playwright — la page est une SPA + challenge Cloudflare,
 * donc impossible à lire en HTTP brut.
 *
 * Stratégie : on ouvre la page d'accueil de la doc, on extrait tous les liens
 * internes de la sidebar, puis on visite chaque page et on dump le contenu
 * texte du <main> (ou article) dans un seul fichier markdown.
 *
 * Sortie : docs/faire-api-dump.md
 *
 * Usage : npx tsx scripts/fetch-faire-docs.ts
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ENTRY = "https://developers.faire.com/docs";
const OUTPUT = "docs/faire-api-dump.md";

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });
  // Retire la signature navigator.webdriver détectée par Cloudflare
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await ctx.newPage();

  console.log(`[faire-docs] Ouverture ${ENTRY}`);
  await page.goto(ENTRY, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Attend jusqu'à 2 minutes que la page se rende — laisse le temps
  // à la cliente de cliquer le challenge Cloudflare manuellement si besoin
  console.log("[faire-docs] En attente de la page (jusqu'à 120s)…");
  console.log("[faire-docs] Si un challenge Cloudflare s'affiche, clique-le dans la fenêtre.");
  let ready = false;
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(5_000);
    const found = await page.evaluate(
      () => document.body.innerText.includes("API Base URL"),
    );
    if (found) {
      ready = true;
      console.log(`[faire-docs] Page chargée après ${(i + 1) * 5}s`);
      break;
    }
  }

  if (!ready) {
    console.log("[faire-docs] Page non chargée — capture diag");
    await page.screenshot({ path: "scripts/.faire-docs-diag.png", fullPage: true });
    const html = await page.content();
    await writeFile("scripts/.faire-docs-diag.html", html, "utf8");
    await browser.close();
    process.exit(1);
  }

  // La doc Faire est rendue en accordéon : on déplie tous les groupes
  // ENDPOINTS de la sidebar pour matérialiser les sous-liens d'opérations
  console.log("[faire-docs] Dépliage des groupes d'endpoints…");
  const groups = ["Brands", "Inventory", "Orders", "Prepacks", "Product Variants", "Products", "Retailers"];
  for (const g of groups) {
    try {
      const target = page.locator(`nav, aside`).locator(`text="${g}"`).first();
      if (await target.count()) {
        await target.click({ timeout: 3_000 });
        await page.waitForTimeout(400);
      }
    } catch {
      // pas grave si un groupe n'est pas cliquable
    }
  }
  await page.waitForTimeout(2_000);

  // Récupère toutes les ancres de la SPA (#/paths/... et #/schemas/...)
  const fragments: string[] = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll<HTMLAnchorElement>("a[href^='#/']").forEach((a) => {
      const href = a.getAttribute("href") ?? "";
      if (href === "#/" || href.startsWith("#/#")) return;
      set.add(href);
    });
    return Array.from(set).sort();
  });

  console.log(`[faire-docs] ${fragments.length} fragments (operations + schemas) détectés`);

  const sections: string[] = [];
  sections.push(`# Faire API — dump complet`);
  sections.push(`Source : ${ENTRY}`);
  sections.push(`Date : ${new Date().toISOString()}`);
  sections.push(`Fragments : ${fragments.length}`);
  sections.push("");

  // Dump 1 : l'overview complet (avec accordéons dépliés)
  const overview = await page.evaluate(() => {
    const root =
      document.querySelector("main") ??
      document.querySelector("[role='main']") ??
      document.body;
    return {
      title: document.title,
      text: (root as HTMLElement).innerText,
    };
  });
  sections.push(`---\n\n## OVERVIEW — ${overview.title}\n`);
  sections.push(overview.text.trim());

  // Dump 2 : chaque opération / schéma en cliquant le fragment
  for (let i = 0; i < fragments.length; i += 1) {
    const frag = fragments[i];
    console.log(`[faire-docs] (${i + 1}/${fragments.length}) ${frag}`);
    try {
      await page.evaluate((f) => {
        location.hash = f.replace(/^#/, "");
      }, frag);
      await page.waitForTimeout(700);
      const dump = await page.evaluate(() => {
        const root =
          document.querySelector("main") ??
          document.querySelector("[role='main']") ??
          document.body;
        return (root as HTMLElement).innerText;
      });
      sections.push(`\n\n---\n\n### ${frag}\n`);
      sections.push(dump.trim());
    } catch (err) {
      sections.push(`\n\n---\n\n### ERREUR ${frag}\n${String(err)}`);
    }
  }

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, sections.join("\n"), "utf8");
  console.log(`[faire-docs] Écrit ${OUTPUT}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
