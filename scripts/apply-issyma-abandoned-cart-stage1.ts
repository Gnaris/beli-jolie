/**
 * Applique le modèle de mail « panier abandonné — stade 1 » design Issyma
 * (palette Bordeaux, tagline FORCYMA, CTA « Reprendre mon panier »). Réécrit
 * `subject` + `blocks` du template lié au stade 1 de `AbandonedCartStage`
 * du tenant ciblé.
 *
 * Défaut : cible le tenant `issyma`. Utiliser `--tenant beliandjolie` pour
 * poser le même design en local sur beliandjolie (aperçu visuel avant push
 * prod).
 *
 * Idempotent : peut être relancé, il ré-applique le même design.
 * Refuse si le stade 1 n'existe pas encore (rien à écraser).
 *
 * Usage :
 *   npx tsx scripts/apply-issyma-abandoned-cart-stage1.ts                          # dry-run issyma
 *   npx tsx scripts/apply-issyma-abandoned-cart-stage1.ts --apply                  # écrit issyma
 *   npx tsx scripts/apply-issyma-abandoned-cart-stage1.ts --tenant beliandjolie --apply
 */

import { prisma } from "@/lib/prisma";
import type { NewsletterBlock } from "@/lib/newsletter-blocks";

const DEFAULT_TENANT_SLUG = "issyma";

// Palette bordeaux Issyma (miroir du HomeIssymaLayout).
const WINE_PRIMARY = "#5f2231"; // CTA + accents
const WINE_DARK = "#3d1620";
const INK = "#2a1418";
const INK_SOFT = "#6b5d5d";
const MUTED = "#8a7460";
const BORDER_SOFT = "#e9dcd6";
const PAPER = "#ffffff";
const BLUSH_BG = "#fbf1ee"; // fond doux features

const SUBJECT = "Votre sélection vous attend";

function buildBlocks(): NewsletterBlock[] {
  return [
    // 1) En-tête ISSYMA élégant — serif, tagline uppercase letterspaced,
    //    fine ligne décorative bordeaux entre les deux.
    {
      id: "iss-abc1-header",
      type: "header",
      data: {
        logo: "",
        logoMaxHeight: 60,
        title: "ISSYMA",
        subtitle: "LE PRÊT-À-PORTER FORCYMA DÉDIÉ AUX PROFESSIONNELS",
        bg: PAPER,
        textColor: WINE_DARK,
        titleFontFamily: "serif",
        titleSize: 40,
        subtitleSize: 10,
        subtitleUppercase: true,
        subtitleLetterSpacing: 24,
        decorativeRule: true,
        ruleColor: WINE_PRIMARY,
        align: "center",
      },
    },

    // 2) Titre principal centré + salutation à gauche
    {
      id: "iss-abc1-title",
      type: "heading",
      data: {
        title: "Votre sélection vous attend",
        body: "Bonjour {firstName},\nRetrouvez les articles sélectionnés pour votre boutique et poursuivez votre commande.",
        align: "left",
        titleAlign: "center",
        bodyAlign: "left",
        titleColor: WINE_DARK,
        bodyColor: INK_SOFT,
        titleSize: 26,
        bodySize: 14,
      },
    },

    // 3) CTA principal — Reprendre mon panier
    {
      id: "iss-abc1-btn-top",
      type: "button",
      data: {
        label: "Reprendre mon panier",
        url: "/panier",
        bg: WINE_PRIMARY,
        color: "#ffffff",
        align: "center",
        labelSize: 14,
      },
    },

    // 4) Éyebrow « VOTRE SÉLECTION »
    {
      id: "iss-abc1-cart-eyebrow",
      type: "heading",
      data: {
        title: "VOTRE SÉLECTION",
        body: "",
        align: "center",
        titleAlign: "center",
        bodyAlign: "center",
        titleColor: WINE_PRIMARY,
        titleSize: 11,
      },
    },

    // 5) Panier réel
    {
      id: "iss-abc1-cart",
      type: "cartItems",
      data: {
        title: "",
        totalLabel: "Sous-total estimé",
        emptyMessage:
          "Votre panier est vide — nos nouveautés vous attendent.",
      },
    },

    // 6) Séparateur avant la section features
    { id: "iss-abc1-div", type: "divider", data: {} },

    // 7) Titre de section
    {
      id: "iss-abc1-features-title",
      type: "heading",
      data: {
        title: "Pour votre boutique, en toute simplicité",
        body: "",
        align: "center",
        titleAlign: "center",
        bodyAlign: "center",
        titleColor: WINE_DARK,
        titleSize: 16,
      },
    },

    // 8) NOUVEAU bloc — 3 features avec cercle icône + label
    {
      id: "iss-abc1-features",
      type: "featuresRow",
      data: {
        items: [
          { icon: "🚚", label: "Livraison suivie\nsous 48 h" },
          { icon: "💬", label: "Conseil dédié\nen français" },
          { icon: "🔒", label: "Paiement 100 %\nsécurisé" },
        ],
        bg: PAPER,
        circleBg: BLUSH_BG,
        iconColor: WINE_PRIMARY,
        labelColor: INK,
        circleSize: 56,
        iconSize: 22,
        labelSize: 12,
      },
    },

    // 9) Second CTA identique
    {
      id: "iss-abc1-btn-bottom",
      type: "button",
      data: {
        label: "Reprendre mon panier",
        url: "/panier",
        bg: WINE_PRIMARY,
        color: "#ffffff",
        align: "center",
        labelSize: 14,
      },
    },

    // 10) Signature
    {
      id: "iss-abc1-sign",
      type: "heading",
      data: {
        title: "",
        body: "À très vite,\nL'équipe {shopName}",
        align: "left",
        bodyAlign: "left",
        bodyColor: MUTED,
        bodySize: 13,
      },
    },

    // 11) Footer légal — contient les 4 variables obligatoires
    {
      id: "iss-abc1-footer",
      type: "footer",
      data: {
        content:
          "{shopName} · {shopAddress}\nSe désinscrire : {unsubscribeLink}\nPolitique de confidentialité : {privacyLink}",
        bg: PAPER,
        color: MUTED,
        align: "center",
        fontSize: 11,
      },
    },
  ];
}

function parseArgs(argv: string[]): { apply: boolean; tenantSlug: string } {
  let apply = false;
  let tenantSlug = DEFAULT_TENANT_SLUG;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--tenant") tenantSlug = argv[++i] ?? tenantSlug;
    else if (a.startsWith("--tenant=")) tenantSlug = a.slice("--tenant=".length);
  }
  return { apply, tenantSlug };
}

async function run() {
  const { apply, tenantSlug } = parseArgs(process.argv);

  const tenant = await prisma.tenant.findFirst({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error(`Tenant slug="${tenantSlug}" introuvable.`);
    process.exit(1);
  }
  console.log(`Tenant cible : ${tenant.slug} (${tenant.name})`);
  console.log(`Mode : ${apply ? "APPLY (écriture)" : "DRY-RUN (aucune écriture)"}\n`);

  const stage = await prisma.abandonedCartStage.findFirst({
    where: { tenantId: tenant.id, stageIndex: 1 },
    include: {
      template: {
        select: { id: true, name: true, subject: true },
      },
    },
  });
  if (!stage) {
    console.error(
      `[${tenant.slug}] Stade 1 introuvable — la boutique n'a pas encore d'automation panier abandonné configurée. Rien à écraser.`,
    );
    console.error(
      `  → Configure d'abord le stade 1 via /admin/marketing/mails/panier-abandonne, puis relance ce script.`,
    );
    process.exit(1);
  }

  const blocks = buildBlocks();

  console.log(`Stade 1 trouvé — template : « ${stage.template.name} »`);
  console.log(`  · subject actuel  : « ${stage.template.subject} »`);
  console.log(`  · subject nouveau : « ${SUBJECT} »`);
  console.log(`  · nb blocs à poser : ${blocks.length}`);
  console.log();

  if (!apply) {
    console.log("Dry-run terminé. Relance avec --apply pour écrire réellement en base.");
    return;
  }

  await prisma.newsletterTemplate.update({
    where: { id: stage.template.id },
    data: {
      subject: SUBJECT,
      blocks: blocks as unknown as object,
    },
  });

  console.log("✔ Design Issyma appliqué au stade 1.");
}

run()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
