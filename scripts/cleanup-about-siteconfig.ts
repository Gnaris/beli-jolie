/**
 * Supprime les 18 clés SiteConfig liées à l'ancienne page « Qui sommes-nous »
 * configurable depuis l'admin.
 *
 * Contexte : la page /a-propos a été retirée (voir CLAUDE.md). Elle sera
 * recodée en dur plus tard pour beliandjolie. En attendant on nettoie les
 * clés orphelines dans SiteConfig pour éviter du bruit en BDD.
 *
 * Clés visées (×2 tenants max) :
 *   about_intro, about_history_body, about_showroom_body, about_team_body,
 *   about_newness_body, about_delivery_body (+ variantes _en)
 *   about_photo_1_url … about_photo_6_url
 *
 * Usage :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/cleanup-about-siteconfig.ts
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/cleanup-about-siteconfig.ts --apply
 *
 * Dry-run par défaut. Ajouter `--apply` pour supprimer réellement.
 */
import { prisma } from "@/lib/prisma";

const KEYS = [
  "about_intro",
  "about_history_body",
  "about_showroom_body",
  "about_team_body",
  "about_newness_body",
  "about_delivery_body",
  "about_intro_en",
  "about_history_body_en",
  "about_showroom_body_en",
  "about_team_body_en",
  "about_newness_body_en",
  "about_delivery_body_en",
  "about_photo_1_url",
  "about_photo_2_url",
  "about_photo_3_url",
  "about_photo_4_url",
  "about_photo_5_url",
  "about_photo_6_url",
];

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: KEYS } },
    select: { tenantId: true, key: true, value: true },
    orderBy: [{ tenantId: "asc" }, { key: "asc" }],
  });

  if (rows.length === 0) {
    console.log("Aucune clé about_* trouvée en BDD — rien à nettoyer.");
    return;
  }

  console.log(`${rows.length} ligne(s) à supprimer :`);
  for (const r of rows) {
    const preview = r.value ? `"${r.value.slice(0, 60).replace(/\n/g, " ")}${r.value.length > 60 ? "…" : ""}"` : "(vide)";
    console.log(`  [${r.tenantId}] ${r.key} = ${preview}`);
  }

  if (!apply) {
    console.log("\nDry-run — relance avec --apply pour supprimer.");
    return;
  }

  const result = await prisma.siteConfig.deleteMany({
    where: { key: { in: KEYS } },
  });
  console.log(`\n${result.count} ligne(s) supprimée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
