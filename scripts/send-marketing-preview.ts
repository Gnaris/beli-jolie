/**
 * Envoie les 4 maquettes d'emails marketing à borischen91@gmail.com
 * pour visualisation en boîte réelle (Gmail).
 *
 * Version ARDOISE — contenu CLAIR, en-tête (hero) SOMBRE avec texte blanc.
 *
 * Usage : npx tsx scripts/send-marketing-preview.ts
 */

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/email";
import { tenantALS } from "@/lib/tenant-als";

const TO = "borischen91@gmail.com";
const CUSTOMER_FIRST_NAME = "Marie";

// ─────────────────────────────────────────────────────────────
// Palette : contenu clair + hero sombre
// ─────────────────────────────────────────────────────────────
const C = {
  slate900: "#0f172a",
  slate800: "#1e293b",
  slate700: "#334155",
  slate600: "#475569",
  slate500: "#64748b",
  slate400: "#94a3b8",
  slate300: "#cbd5e1",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f8fafc",
  white: "#ffffff",
};

// Fonds SOLIDES (Gmail n'affiche pas les linear-gradient dans les <td>)
const G = {
  thumbLight: "#cbd5e1",
  thumbMed: "#64748b",
  thumbDark: "#334155",
  hero: "#0f172a", // noir ardoise — texte blanc
};

const FONT = "'Roboto', Arial, sans-serif";
const FONT_HEADING = "'Poppins', Arial, sans-serif";

function shell(title: string, content: string, footer: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f6;font-family:${FONT};color:${C.slate900};">
<div style="display:none;max-height:0;overflow:hidden;">${title}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f6;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;width:100%;background:${C.white};border-radius:20px;overflow:hidden;box-shadow:0 30px 60px -20px rgba(15,23,42,0.15);">
        ${content}
        <tr>
          <td style="background:${C.slate50};padding:24px 32px;text-align:center;font-size:12px;color:${C.slate400};line-height:1.7;border-top:1px solid ${C.slate200};">
            ${footer}
          </td>
        </tr>
      </table>
      <div style="max-width:640px;margin:16px auto 0;font-size:11px;color:#94a3b8;text-align:center;">
        Aperçu maquette — envoyé pour validation visuelle uniquement.
      </div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Eyebrow pour hero sombre (texte gris clair)
function eyebrowLight(text: string): string {
  return `<div style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate300};">${text}</div>`;
}

// Eyebrow pour contenu clair (texte gris moyen)
function eyebrow(text: string): string {
  return `<div style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate500};">${text}</div>`;
}

// Chip clair (utilisé dans le contenu)
function chip(text: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;background:${C.slate100};color:${C.slate700};border:1px solid ${C.slate200};">${text}</span>`;
}

// Chip sombre (utilisé dans le hero sombre)
function chipLight(text: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;background:rgba(255,255,255,0.1);color:${C.white};border:1px solid rgba(255,255,255,0.2);">${text}</span>`;
}

function cta(label: string, href = "#"): string {
  return `<a href="${href}" style="display:inline-block;background:${C.slate900};color:${C.white};padding:14px 28px;border-radius:12px;font-weight:600;text-decoration:none;font-family:${FONT_HEADING};letter-spacing:0.02em;">${label}</a>`;
}

// Bloc hero sombre réutilisable (texte blanc lisible)
// bgcolor + style = compat Gmail/Outlook/Apple Mail
function heroDark(inner: string): string {
  return `
    <tr>
      <td bgcolor="${G.hero}" style="background-color:${G.hero};padding:40px 32px;text-align:center;color:${C.white};">
        ${inner}
      </td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────
// EMAIL 1 — Panier abandonné
// ─────────────────────────────────────────────────────────────
function emailPanier(): { subject: string; html: string } {
  const productRow = (initial: string, name: string, meta: string, price: string) => `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.slate50};border:1px solid ${C.slate200};border-radius:14px;">
          <tr>
            <td width="100" style="padding:16px;">
              <div style="width:84px;height:84px;border-radius:10px;background:${G.thumbMed};color:${C.white};font-weight:600;font-size:24px;line-height:84px;text-align:center;font-family:${FONT_HEADING};">${initial}</div>
            </td>
            <td style="padding:16px 8px;">
              <div style="font-weight:500;color:${C.slate900};font-size:15px;">${name}</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">${meta}</div>
            </td>
            <td align="right" style="padding:16px;font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:15px;">${price}</td>
          </tr>
        </table>
      </td>
    </tr>`;

  const hero = heroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">🛒</div>
    <div style="margin-top:16px;">${eyebrowLight("Panier en pause")}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:8px 0 0;color:${C.white};">Vos articles vous attendent</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">Bonjour ${CUSTOMER_FIRST_NAME}, vous avez commencé une commande hier. On vous a mis les articles de côté — ils sont toujours disponibles.</p>
  `);

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${productRow("B", "Bague acier fleur émaillée", "Réf. BAG-2451 · Rose · Qté 6", "18,00 €")}
          ${productRow("C", "Collier chaîne fine dorée", "Réf. COL-1187 · Doré · Qté 12", "36,00 €")}
          ${productRow("B", "Boucles d'oreilles créoles nacre", "Réf. BO-3042 · Blanc · Qté 8", "24,00 €")}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:24px;background:${C.slate50};border:1px solid ${C.slate200};border-radius:12px;">
          <tr>
            <td style="padding:16px 20px;">
              <div style="font-size:12px;color:${C.slate500};">Total du panier</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;font-size:28px;color:${C.slate900};margin-top:4px;">78,00 €</div>
            </td>
            <td align="right" style="padding:16px 20px;">${chip("3 articles")}</td>
          </tr>
        </table>

        <div style="text-align:center;margin-top:32px;">
          ${cta("Reprendre ma commande →")}
          <div style="margin-top:14px;font-size:11px;color:${C.slate400};">Ce lien expire dans 7 jours</div>
        </div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">Livraison offerte</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Dès 200 €</div>
            </td>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">Expédition 24 h</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Colis suivi</div>
            </td>
            <td width="33%" align="center" style="padding:4px;">
              <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;">SAV réactif</div>
              <div style="font-size:12px;color:${C.slate500};margin-top:4px;">Réponse &lt; 24 h</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const footer = `
    Vous recevez cet email parce que vous avez un compte professionnel sur beliandjolie.com.<br />
    <a href="#" style="color:${C.slate600};">Gérer mes préférences</a> · <a href="#" style="color:${C.slate600};">Ne plus recevoir de rappels de panier</a><br />
    Beli &amp; Jolie · 90 rue de la Haie Coq, 93300 Aubervilliers`;

  return {
    subject: "Vous avez laissé quelques articles derrière vous",
    html: shell("Panier abandonné", content, footer),
  };
}

// ─────────────────────────────────────────────────────────────
// EMAIL 2 — Retour en stock
// ─────────────────────────────────────────────────────────────
function emailStock(): { subject: string; html: string } {
  const suggestion = (name: string, price: string) => `
    <td width="33%" align="center" style="padding:4px;">
      <div style="height:90px;background:${G.thumbLight};border-radius:10px;line-height:90px;font-size:28px;color:${C.slate600};">◆</div>
      <div style="font-size:12px;margin-top:8px;font-weight:500;color:${C.slate900};">${name}</div>
      <div style="font-size:12px;color:${C.slate500};">${price}</div>
    </td>`;

  const hero = heroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="margin-top:14px;">${chipLight("Bonne nouvelle")}</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:12px 0 0;color:${C.white};">Un de vos favoris est de retour</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">Vous l'aviez enregistré, il était en rupture. Il vient d'être réapprovisionné.</p>
  `);

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="height:220px;background:${G.thumbMed};text-align:center;font-size:64px;line-height:220px;color:${C.white};">◆</td>
          </tr>
          <tr>
            <td style="padding:20px;">
              <div style="font-size:11px;color:${C.slate500};">Réf. BAG-9821</div>
              <div style="font-family:${FONT_HEADING};font-weight:600;font-size:18px;margin-top:4px;color:${C.slate900};">Bague solitaire zircon acier</div>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;">
                <tr>
                  <td>
                    <div style="font-size:11px;color:${C.slate500};">Prix pro (par pièce)</div>
                    <div style="font-family:${FONT_HEADING};font-weight:600;font-size:24px;color:${C.slate900};margin-top:2px;">4,20 €</div>
                  </td>
                  <td align="right">${chip("En stock")}</td>
                </tr>
              </table>
              <div style="margin-top:16px;text-align:center;">
                <a href="#" style="display:block;background:${C.slate900};color:${C.white};padding:14px;border-radius:12px;font-weight:600;text-decoration:none;font-family:${FONT_HEADING};">Voir le produit</a>
              </div>
            </td>
          </tr>
        </table>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="margin-bottom:12px;">${eyebrow("Vous aimerez peut-être aussi")}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${suggestion("Bague trilogie", "3,80 €")}
            ${suggestion("Bague jonc doré", "4,50 €")}
            ${suggestion("Bague cœur émaillé", "3,90 €")}
          </tr>
        </table>
      </td>
    </tr>`;

  const footer = `
    Vous recevez cet email parce que vous avez ajouté ce produit à vos favoris.<br />
    <a href="#" style="color:${C.slate600};">Gérer mes favoris</a> · <a href="#" style="color:${C.slate600};">Se désabonner des alertes stock</a><br />
    Beli &amp; Jolie · 90 rue de la Haie Coq, 93300 Aubervilliers`;

  return {
    subject: "Bonne nouvelle — un de vos favoris est de retour",
    html: shell("Retour en stock", content, footer),
  };
}

// ─────────────────────────────────────────────────────────────
// EMAIL 3 — Bienvenue
// ─────────────────────────────────────────────────────────────
function emailWelcome(): { subject: string; html: string } {
  const step = (n: string, title: string, desc: string) => `
    <tr>
      <td style="padding:6px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:12px;">
          <tr>
            <td width="60" valign="top" style="padding:16px;">
              <div style="width:36px;height:36px;border-radius:50%;background:${C.slate900};color:${C.white};text-align:center;line-height:36px;font-weight:600;font-family:${FONT_HEADING};">${n}</div>
            </td>
            <td valign="top" style="padding:16px 16px 16px 0;">
              <div style="font-weight:500;color:${C.slate900};">${title}</div>
              <div style="font-size:13px;color:${C.slate500};margin-top:4px;line-height:1.5;">${desc}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const hero = heroDark(`
    <div style="width:64px;height:64px;border-radius:20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:inline-block;font-size:28px;line-height:64px;color:${C.white};">✦</div>
    <div style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;font-weight:600;color:${C.slate300};margin-top:14px;">Compte activé</div>
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:8px 0 0;color:${C.white};">Bienvenue dans la maison, ${CUSTOMER_FIRST_NAME}</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:460px;">Votre compte professionnel est validé. Vous avez maintenant accès aux prix pros et à l'ensemble du catalogue.</p>
  `);

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <div style="text-align:center;">${cta("Découvrir les nouveautés →")}</div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="margin-bottom:16px;">${eyebrow("Pour bien démarrer")}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${step("1", "Explorez le catalogue", "Plus de 9 000 références en acier inoxydable, réassorties chaque semaine.")}
          ${step("2", "Enregistrez vos favoris", "Cœur sur un produit → vous êtes averti dès qu'il revient en stock.")}
          ${step("3", "Passez votre 1<sup>re</sup> commande", "Livraison offerte dès 200 € · expédition sous 24 h.")}
        </table>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <div style="text-align:center;">
          <div style="margin-bottom:8px;">${eyebrow("Une question ?")}</div>
          <p style="color:${C.slate600};font-size:14px;line-height:1.6;">Écrivez à <a href="mailto:contact@beliandjolie.com" style="color:${C.slate900};font-weight:500;">contact@beliandjolie.com</a> ou appelez le <strong>07 82 75 81 58</strong> — on vous répond en moins de 24 h.</p>
        </div>
      </td>
    </tr>`;

  const footer = `
    Beli &amp; Jolie · 90 rue de la Haie Coq, 93300 Aubervilliers<br />
    <a href="#" style="color:${C.slate600};">Se désabonner des communications commerciales</a>`;

  return {
    subject: "Bienvenue chez Beli & Jolie — votre compte est activé",
    html: shell("Bienvenue", content, footer),
  };
}

// ─────────────────────────────────────────────────────────────
// EMAIL 4 — Nouveautés
// ─────────────────────────────────────────────────────────────
function emailNews(): { subject: string; html: string } {
  const newProduct = (name: string, price: string) => `
    <td width="50%" valign="top" style="padding:6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid ${C.slate200};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="height:150px;background:${G.thumbLight};text-align:center;font-size:48px;line-height:150px;color:${C.slate600};">◆</td>
        </tr>
        <tr>
          <td style="padding:12px;">
            ${chip("Nouveau")}
            <div style="font-weight:500;color:${C.slate900};font-size:13px;margin-top:8px;">${name}</div>
            <div style="font-family:${FONT_HEADING};font-weight:600;color:${C.slate900};font-size:14px;margin-top:4px;">${price}</div>
          </td>
        </tr>
      </table>
    </td>`;

  const hero = heroDark(`
    ${chipLight("Nouveautés · Semaine 30")}
    <h1 style="font-family:${FONT_HEADING};font-weight:700;font-size:26px;margin:16px 0 0;color:${C.white};">42 nouveaux modèles cette semaine</h1>
    <p style="color:${C.slate300};line-height:1.6;margin:12px auto 0;max-width:440px;">Voici notre sélection coup de cœur. Le reste vous attend sur le site.</p>
  `);

  const content = `
    ${hero}
    <tr>
      <td style="padding:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${newProduct("Bague fleur émail rose", "3,80 €")}
            ${newProduct("Collier perles baroques", "5,20 €")}
          </tr>
          <tr>
            ${newProduct("Boucles créoles zircon", "4,50 €")}
            ${newProduct("Bracelet jonc émaillé lila", "4,10 €")}
          </tr>
        </table>

        <div style="text-align:center;margin-top:24px;">${cta("Voir toutes les nouveautés →")}</div>

        <div style="height:1px;background:${C.slate200};margin:32px 0;"></div>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.slate50};border:1px solid ${C.slate200};border-radius:16px;">
          <tr>
            <td style="padding:20px;">
              <div style="margin-bottom:10px;">${eyebrow("Notre coup de cœur")}</div>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="86" valign="top">
                    <div style="width:70px;height:70px;border-radius:12px;background:${G.thumbDark};text-align:center;font-size:32px;line-height:70px;color:${C.white};">✦</div>
                  </td>
                  <td valign="middle">
                    <div style="font-weight:500;color:${C.slate900};">La collection « Bracelets thaïlandais »</div>
                    <div style="font-size:12px;color:${C.slate500};margin-top:4px;">32 joncs émaillés fins, teintes tendance été 2026.</div>
                  </td>
                  <td align="right" valign="middle">
                    <a href="#" style="display:inline-block;padding:10px 16px;border-radius:10px;font-weight:500;text-decoration:none;color:${C.slate900};border:1px solid ${C.slate200};background:${C.white};font-size:13px;">Voir</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;

  const footer = `
    Vous recevez cette newsletter parce que vous avez accepté les communications commerciales.<br />
    <a href="#" style="color:${C.slate600};">Se désabonner de la newsletter</a> · <a href="#" style="color:${C.slate600};">Gérer mes préférences</a><br />
    Beli &amp; Jolie · 90 rue de la Haie Coq, 93300 Aubervilliers`;

  return {
    subject: "Les nouveautés de la semaine sont arrivées",
    html: shell("Nouveautés", content, footer),
  };
}

// ─────────────────────────────────────────────────────────────
// Envoi séquentiel
// ─────────────────────────────────────────────────────────────
async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: { in: ["beliandjolie", "beli-jolie"] } },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    console.error("Tenant beliandjolie introuvable en BDD locale.");
    process.exit(1);
  }
  console.log(`Tenant : ${tenant.name} (${tenant.slug}, ${tenant.id})`);

  await tenantALS.run(tenant.id, async () => {
    const emails = [
      { key: "01 · Panier abandonné", ...emailPanier() },
      { key: "02 · Retour en stock", ...emailStock() },
      { key: "03 · Bienvenue", ...emailWelcome() },
      { key: "04 · Nouveautés", ...emailNews() },
    ];

    for (const email of emails) {
      const prefixedSubject = `[v6 · Hero solide ardoise ${email.key}] ${email.subject}`;
      const result = await sendMail({
        to: TO,
        subject: prefixedSubject,
        html: email.html,
      });
      if (result.sent) {
        console.log(`✅ ${email.key} — id ${result.id}`);
      } else {
        console.error(`❌ ${email.key} — ${result.reason} ${"error" in result ? result.error : ""}`);
      }
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
