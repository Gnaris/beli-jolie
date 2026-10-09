/**
 * Seed des rubriques « Foire aux informations » par défaut pour Issyma.
 *
 * Pose exactement les 2 rubriques (Tailles et mesures + Livraison) qui
 * étaient figées côté public, avec leur texte historique — pour que
 * l'activation de la feature ne change rien visuellement.
 *
 * Idempotent & safe :
 *   - N'écrit QUE si SiteConfig[product_faq_defaults] est absent ou vide
 *     pour le tenant Issyma.
 *   - Si des rubriques sont déjà configurées (manuellement via l'admin ou
 *     ce script lors d'un run précédent), le script ne touche à rien et
 *     affiche un message.
 *
 * Usage :
 *   - Local (sur beliandjolie, pour tester l'UI admin) :
 *       `npx tsx scripts/seed-issyma-product-faq.ts --slug beliandjolie`
 *   - Prod (sur issyma, pour conserver le visuel actuel) :
 *       `ssh root@… "cd /var/www/beliandjolie && npx tsx scripts/seed-issyma-product-faq.ts"`
 *
 * Par défaut, cible le tenant "issyma". Accepte `--slug <slug>` pour cibler
 * un autre tenant. Aucun effet si le tenant n'existe pas.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY = "product_faq_defaults";

function parseSlug(): string {
  const idx = process.argv.indexOf("--slug");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return "issyma";
}

// Ids stables : évitent les ré-écritures intempestives et permettent aux
// surcharges produit (Product.faqOverrides) de rester valides si le script
// est relancé.
const DEFAULT_ITEMS = [
  {
    id: "issyma-sizes-default",
    title: "Tailles et mesures",
    body:
      "Contactez-nous si vous avez besoin des mesures détaillées.",
  },
  {
    id: "issyma-shipping-default",
    title: "Livraison",
    body:
      "Préparation sous 24-48 h ouvrées. Le délai de transport dépend ensuite du transporteur. Retour possible sous 14 jours, frais à la charge du client. Voir nos CGV.",
  },
];

async function main() {
  const slug = parseSlug();
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });

  if (!tenant) {
    console.error(
      `[seed-issyma-product-faq] Tenant "${slug}" introuvable. Rien à faire.`,
    );
    process.exit(1);
  }

  console.log(`[seed-issyma-product-faq] Tenant ${tenant.name} (${tenant.id})`);

  const existing = await prisma.siteConfig.findUnique({
    where: { tenantId_key: { tenantId: tenant.id, key: KEY } },
  });

  const existingValue = (existing?.value ?? "").trim();
  if (existingValue && existingValue !== "[]") {
    console.log(
      `[seed-issyma-product-faq] Déjà configuré (${existingValue.length} caractères). On ne touche à rien.`,
    );
    return;
  }

  const payload = JSON.stringify(DEFAULT_ITEMS);
  await prisma.siteConfig.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: KEY } },
    update: { value: payload },
    create: { tenantId: tenant.id, key: KEY, value: payload },
  });

  console.log(
    `[seed-issyma-product-faq] ✔ ${DEFAULT_ITEMS.length} rubriques posées (${DEFAULT_ITEMS
      .map((i) => i.title)
      .join(", ")}).`,
  );
  console.log(
    "[seed-issyma-product-faq] Terminé. Rafraîchissez une fiche produit Issyma pour voir le résultat.",
  );
}

main()
  .catch((e) => {
    console.error("[seed-issyma-product-faq] Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
