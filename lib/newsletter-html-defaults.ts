/**
 * Modèles HTML par défaut pour :
 *   - un nouveau modèle newsletter manuel (aucun scénario),
 *   - les 3 scénarios automatiques (ABANDONED_CART, INACTIVE_CLIENT, RESTOCK).
 *
 * Chaque modèle scénario inclut la boucle `{{#each …}}` ou le token `{days}`
 * nécessaire pour que le mail affiche les vraies données du client à l'envoi.
 * Tous incluent les 4 tokens marketing obligatoires (RGPD/LCEN) dans le
 * pied de page — validation passe dès la 1ʳᵉ ouverture.
 *
 * Module pur — safe pour import client et serveur. Source de vérité unique
 * pour les 3 scénarios transactionnels (clé, libellé, HTML par défaut).
 */

export type ScenarioKey = "ABANDONED_CART" | "INACTIVE_CLIENT" | "RESTOCK";

export const SCENARIO_KEYS: readonly ScenarioKey[] = [
  "ABANDONED_CART",
  "INACTIVE_CLIENT",
  "RESTOCK",
] as const;

export const SCENARIO_LABELS: Record<ScenarioKey, string> = {
  ABANDONED_CART: "Panier abandonné",
  INACTIVE_CLIENT: "Relance inactivité",
  RESTOCK: "Retour en stock",
};

export const SCENARIO_DEFAULT_NAMES: Record<ScenarioKey, string> = {
  ABANDONED_CART: "Panier abandonné (par défaut)",
  INACTIVE_CLIENT: "Relance inactivité (par défaut)",
  RESTOCK: "Retour en stock (par défaut)",
};

export interface ScenarioHtmlDefault {
  name: string;
  subject: string;
  html: string;
}

/**
 * Squelette HTML de base réutilisé pour un modèle manuel — la cliente
 * réécrit à son goût. Vide de contenu marketing (charge à elle) mais
 * pré-remplit les 4 tokens légaux.
 */
export const MANUAL_HTML_DEFAULT = `<!doctype html>
<html lang="fr">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 24px;">
          <h1 style="font-family:'Poppins',sans-serif;font-size:22px;margin:0 0 12px;color:#0f172a;">
            Bonjour {firstName},
          </h1>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px;">
            Votre message ici.
          </p>
          <p style="text-align:center;margin:24px 0;">
            <a href="" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 28px;border-radius:10px;font-weight:600;text-decoration:none;">
              Découvrir
            </a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;color:#64748b;padding:20px 24px;text-align:center;font-size:12px;line-height:1.6;">
          {shopName} · {shopAddress}<br>
          <a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire</a> · <a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const ABANDONED_CART_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 24px;">
          <h1 style="font-family:'Poppins',sans-serif;font-size:22px;margin:0 0 12px;color:#0f172a;">
            {firstName}, vous avez oublié quelque chose
          </h1>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 20px;">
            Votre panier chez {shopName} vous attend. Voici les articles que vous aviez mis de côté :
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:10px;padding:8px;margin:0 0 8px;">
            {{#each cart}}
            <tr>
              <td width="60" style="padding:8px;vertical-align:top;">
                <img src="{image}" alt="{name}" width="52" height="52" style="width:52px;height:52px;display:block;object-fit:cover;border-radius:6px;">
              </td>
              <td style="padding:8px;vertical-align:middle;">
                <div style="font-size:13px;font-weight:600;color:#0f172a;">{name}</div>
                <div style="font-size:11px;color:#64748b;">{color} · × {qty}</div>
              </td>
              <td align="right" style="padding:8px;vertical-align:middle;font-weight:700;font-size:13px;color:#0f172a;white-space:nowrap;">
                {total}
              </td>
            </tr>
            {{/each}}
          </table>

          <p style="text-align:center;font-size:12px;color:#94a3b8;font-style:italic;margin:0 0 12px;">{cartMoreText}</p>

          <p style="text-align:right;font-size:14px;font-weight:700;color:#0f172a;margin:0 0 24px;">
            Total ({cartCount} article(s)) : {cartTotal}
          </p>

          <p style="text-align:center;margin:24px 0;">
            <a href="" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 32px;border-radius:10px;font-weight:600;text-decoration:none;">
              Reprendre mon panier
            </a>
          </p>

          <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:20px 0 0;text-align:center;">
            Une question ? Répondez simplement à ce mail, nous vous répondrons rapidement.
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;color:#64748b;padding:20px 24px;text-align:center;font-size:11px;line-height:1.6;">
          {shopName} · {shopAddress}<br>
          <a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire des relances panier</a> · <a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const INACTIVE_CLIENT_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 24px;">
          <h1 style="font-family:'Poppins',sans-serif;font-size:22px;margin:0 0 12px;color:#0f172a;">
            {firstName}, ça fait {days} jour(s) qu'on ne vous a pas vu
          </h1>
          <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px;">
            De nouvelles pièces sont arrivées chez {shopName} depuis votre dernière visite —
            venez y jeter un œil, il y a peut-être des nouveautés qui vous plairont.
          </p>
          <p style="text-align:center;margin:24px 0;">
            <a href="" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 32px;border-radius:10px;font-weight:600;text-decoration:none;">
              Découvrir les nouveautés
            </a>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;color:#64748b;padding:20px 24px;text-align:center;font-size:11px;line-height:1.6;">
          {shopName} · {shopAddress}<br>
          <a href="{unsubscribeLink}" style="color:#64748b;">Se désinscrire des relances inactivité</a> · <a href="{privacyLink}" style="color:#64748b;">Politique de confidentialité</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const RESTOCK_HTML = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Retour en stock — {shopName}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.04);">

        <!-- Eyebrow + nom boutique -->
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#64748b;font-weight:700;">
            {shopName}
          </p>
        </td></tr>

        <!-- Hero titre -->
        <tr><td style="padding:12px 32px 0 32px;">
          <h1 style="margin:0;font-size:30px;line-height:1.15;letter-spacing:-0.02em;color:#0f172a;font-weight:700;">
            C'est de retour,<br>{firstName}.
          </h1>
          <p style="margin:14px 0 0 0;font-size:15px;line-height:1.55;color:#475569;">
            {restockTotal} produit(s) que vous aviez repéré(s) viennent de revenir en stock.
          </p>
        </td></tr>

        <!-- Divider fin -->
        <tr><td style="padding:28px 32px 0 32px;">
          <div style="height:1px;background:#e2e8f0;line-height:1px;font-size:0;">&nbsp;</div>
        </td></tr>

        <!-- Section favoris -->
        <tr><td style="padding:24px 32px 0 32px;">
          <p style="margin:0 0 4px 0;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;font-weight:700;">
            Vos coups de cœur
          </p>
          <p style="margin:0 0 16px 0;font-size:18px;color:#0f172a;font-weight:600;">
            De nouveau disponibles
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            {{#each favorites}}
            <tr>
              <td width="72" style="padding:0 14px 14px 0;vertical-align:top;">
                <img src="{image}" alt="{name}" width="72" height="72" style="width:72px;height:72px;display:block;object-fit:cover;border-radius:12px;background:#f8fafc;">
              </td>
              <td style="padding:0 0 14px 0;vertical-align:middle;">
                <div style="font-size:14px;font-weight:600;color:#0f172a;line-height:1.3;">{name}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px;">{color}</div>
                <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:6px;">{price}</div>
              </td>
            </tr>
            {{/each}}
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic;">{favoritesMoreText}</p>
        </td></tr>

        <!-- Section déjà commandés -->
        <tr><td style="padding:24px 32px 0 32px;">
          <p style="margin:0 0 4px 0;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;font-weight:700;">
            Vous avez déjà aimé
          </p>
          <p style="margin:0 0 16px 0;font-size:18px;color:#0f172a;font-weight:600;">
            Prêt à recommander
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            {{#each ordered}}
            <tr>
              <td width="72" style="padding:0 14px 14px 0;vertical-align:top;">
                <img src="{image}" alt="{name}" width="72" height="72" style="width:72px;height:72px;display:block;object-fit:cover;border-radius:12px;background:#f8fafc;">
              </td>
              <td style="padding:0 0 14px 0;vertical-align:middle;">
                <div style="font-size:14px;font-weight:600;color:#0f172a;line-height:1.3;">{name}</div>
                <div style="font-size:12px;color:#64748b;margin-top:2px;">{color}</div>
                <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:6px;">{price}</div>
              </td>
            </tr>
            {{/each}}
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic;">{orderedMoreText}</p>
        </td></tr>

        <!-- CTA -->
        <tr><td align="center" style="padding:32px 32px 36px 32px;">
          <a href="" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 36px;border-radius:999px;font-size:14px;font-weight:600;letter-spacing:0.01em;text-decoration:none;">
            Découvrir la boutique
          </a>
          <p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;">
            Les stocks fondent vite — à bon entendeur.
          </p>
        </td></tr>

        <!-- Pied de page légal -->
        <tr><td style="background:#f8fafc;padding:20px 32px;text-align:center;font-size:11px;line-height:1.6;color:#94a3b8;">
          <p style="margin:0;">{shopName} · {shopAddress}</p>
          <p style="margin:4px 0 0 0;">
            <a href="{unsubscribeLink}" style="color:#64748b;text-decoration:underline;">Se désinscrire</a>
            &nbsp;·&nbsp;
            <a href="{privacyLink}" style="color:#64748b;text-decoration:underline;">Politique de confidentialité</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export const SCENARIO_HTML_DEFAULTS: Record<ScenarioKey, ScenarioHtmlDefault> = {
  ABANDONED_CART: {
    name: "Panier abandonné (par défaut)",
    subject: "Vous avez oublié votre panier chez {shopName}",
    html: ABANDONED_CART_HTML,
  },
  INACTIVE_CLIENT: {
    name: "Relance inactivité (par défaut)",
    subject: "On ne vous a pas vu depuis {days} jours…",
    html: INACTIVE_CLIENT_HTML,
  },
  RESTOCK: {
    name: "Retour en stock (par défaut)",
    subject: "{firstName}, vos produits préférés sont de retour",
    html: RESTOCK_HTML,
  },
};
