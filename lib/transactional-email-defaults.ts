/**
 * Modèles par défaut (FR) pour chaque mail transactionnel.
 *
 * Chaque entrée fournit :
 *  - `subject` : sujet avec tokens {var}
 *  - `html`    : corps complet HTML avec tokens {var}
 *
 * Les tokens sont interpolés par `renderTransactionalEmail()` au moment de
 * l'envoi (lib/transactional-email-render.ts).
 *
 * Ces modèles sont la source de vérité :
 *  1. Pré-remplissent l'éditeur admin la première fois qu'il est ouvert.
 *  2. Servent de fallback si aucun override n'existe en BDD.
 *  3. Sont restaurés quand la cliente clique sur « Revenir au modèle par défaut ».
 *
 * Module PUR (0 dépendance serveur) — safe pour import client et serveur.
 */

import type { TransactionalScenarioKey } from "@/lib/transactional-email-scenarios";

export interface TransactionalEmailTemplate {
  subject: string;
  html: string;
}

export const TRANSACTIONAL_DEFAULTS: Record<TransactionalScenarioKey, TransactionalEmailTemplate> = {
  // ─────────────────────────────────────────────
  // CLIENT — auth
  // ─────────────────────────────────────────────
  LOGIN_OTP: {
    subject: "Votre code de connexion — {shopName}",
    html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <h2 style="color:#1A1A1A;margin-bottom:8px">Votre code de connexion</h2>
  <p style="color:#6B6B6B;margin-bottom:24px">Utilisez le code ci-dessous pour vous connecter à votre espace professionnel. Ce code est valable <strong>10 minutes</strong>.</p>
  <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;background:#F5F5F5;color:#1A1A1A;padding:20px;border-radius:12px;text-align:center;margin:16px 0">{code}</div>
  <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Votre compte reste sécurisé.</p>
</div>`,
  },

  PASSWORD_RESET: {
    subject: "Réinitialisation de votre mot de passe — {shopName}",
    html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
  <h2 style="color:#1A1A1A;margin-bottom:8px">Réinitialisation du mot de passe</h2>
  <p style="color:#6B6B6B;margin-bottom:24px">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable <strong>1 heure</strong>.</p>
  <a href="{resetUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Réinitialiser mon mot de passe</a>
  <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Votre mot de passe ne sera pas modifié.</p>
  <p style="color:#9CA3AF;font-size:11px;margin-top:8px">Lien direct : {resetUrl}</p>
</div>`,
  },

  EMAIL_CHANGE_CONFIRM: {
    subject: "Confirmez votre nouvelle adresse email — {shopName}",
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
  <h2 style="color:#1A1A1A;margin-bottom:8px">Confirmez votre nouvelle adresse email</h2>
  <p style="color:#6B6B6B;margin-bottom:24px">Vous avez demandé à utiliser cette adresse comme nouvel email de connexion sur <strong>{shopName}</strong>. Cliquez sur le bouton ci-dessous pour valider le changement. Ce lien est valable <strong>1 heure</strong>.</p>
  <p style="margin-bottom:24px"><a href="{confirmUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Confirmer mon nouvel email</a></p>
  <p style="color:#9CA3AF;font-size:12px;margin-top:24px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email. Aucune modification ne sera faite.</p>
  <p style="color:#9CA3AF;font-size:11px;margin-top:8px">Lien direct : {confirmUrl}</p>
</div>`,
  },

  EMAIL_CHANGE_NOTICE: {
    subject: "Demande de changement d'email sur votre compte — {shopName}",
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
  <h2 style="color:#1A1A1A;margin-bottom:8px">Demande de changement d'email</h2>
  <p style="color:#6B6B6B;margin-bottom:16px">Nous vous informons qu'une demande a été faite pour remplacer l'adresse email de votre compte <strong>{shopName}</strong> par :</p>
  <p style="margin:0 0 24px;font-weight:600;color:#1A1A1A">{newEmail}</p>
  <p style="color:#6B6B6B;margin-bottom:24px">Le changement ne sera effectif qu'après confirmation via un lien envoyé à cette nouvelle adresse.</p>
  <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:12px 16px;margin-bottom:24px">
    <p style="color:#78350F;margin:0;font-size:13px"><strong>Ce n'est pas vous ?</strong> Changez votre mot de passe immédiatement en cliquant <a href="{resetUrl}" style="color:#78350F;text-decoration:underline">ici</a>, puis contactez-nous.</p>
  </div>
  <p style="color:#9CA3AF;font-size:12px">Ce message est purement informatif, aucune action n'est nécessaire de votre côté si vous êtes bien à l'origine de la demande.</p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // CLIENT — compte
  // ─────────────────────────────────────────────
  ACCOUNT_APPROVED: {
    subject: "Votre compte a été validé — {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#16A34A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">✅</div>
    <h2 style="margin:0;font-size:20px;">Bienvenue sur {shopName}</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Bonne nouvelle : votre compte professionnel a été validé par notre équipe.
      Vous pouvez maintenant vous connecter, consulter notre catalogue et passer commande.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="{loginUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Accéder à la boutique →
      </a>
    </div>
    <p style="margin-top:24px;font-size:13px;color:#6B6B6B;text-align:center;">À très vite sur {shopName}.</p>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ACCOUNT_REJECTED: {
    subject: "Votre demande de compte — {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#1A1A1A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <h2 style="margin:0;font-size:20px;">Votre demande d'inscription</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Après examen, nous ne sommes pas en mesure de valider votre compte
      professionnel sur {shopName}.
    </p>
    {reasonBlock}
    {contactBlock}
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ACCOUNT_REVOKED: {
    subject: "Votre compte a été désactivé — {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#1A1A1A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <h2 style="margin:0;font-size:20px;">Votre compte a été désactivé</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Nous vous informons que votre compte professionnel sur
      {shopName} a été désactivé.
      Vous ne pouvez plus vous connecter ni passer commande jusqu'à
      nouvel ordre.
    </p>
    {reasonBlock}
    {contactBlock}
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ACCOUNT_INACTIVITY_WARNING: {
    subject: "Vous nous manquez, {firstName} — votre accès pro {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#F59E0B;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">👋</div>
    <h2 style="margin:0;font-size:20px;">Vous nous manquez</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Cela fait maintenant <strong>{daysInactive} jours</strong> que nous n'avons pas eu le plaisir de préparer une commande pour vous sur {shopName}.
    </p>
    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 18px;margin:20px 0;border-radius:4px;">
      <p style="margin:0;color:#78350F;font-size:14px;line-height:1.5;">
        Si vous ne passez pas de commande dans les <strong>{graceDays} prochains jours</strong>, votre compte professionnel sera automatiquement mis en pause. Vous pourrez toujours vous connecter, mais les tarifs pro ne seront plus visibles tant qu'un administrateur ne vous aura pas réactivé.
      </p>
    </div>
    <p style="font-size:15px;line-height:1.6;">
      C'est le bon moment pour venir redécouvrir nos nouveautés — nous serions ravis de vous retrouver.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="{catalogUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir le catalogue →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ACCOUNT_REACTIVATED_PROBATION: {
    subject: "Votre compte est réactivé — {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#16A34A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🎉</div>
    <h2 style="margin:0;font-size:20px;">Votre compte est réactivé</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Bonne nouvelle : votre compte professionnel sur {shopName} vient d'être
      réactivé. Vous retrouvez l'accès complet au catalogue, aux tarifs pro et
      à la commande.
    </p>
    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;padding:14px 18px;margin:20px 0;border-radius:4px;">
      <p style="margin:0;color:#78350F;font-size:14px;line-height:1.5;">
        <strong>Petit rappel :</strong> pour garder votre compte actif, pensez
        à passer une commande dans les <strong>{probationDays} prochains
        jours</strong>. Sans commande d'ici là, votre compte sera à nouveau
        mis en pause automatiquement.
      </p>
    </div>
    <div style="text-align:center;margin-top:24px;">
      <a href="{catalogUrl}" style="background:#16A34A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir le catalogue →
      </a>
    </div>
    <p style="margin-top:24px;font-size:13px;color:#6B6B6B;text-align:center;">À très vite sur {shopName}.</p>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ACCOUNT_INACTIVITY_REVOKED: {
    subject: "Votre compte a été mis en pause — {shopName}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#64748B;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">⏸️</div>
    <h2 style="margin:0;font-size:20px;">Votre compte a été mis en pause</h2>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">
      Bonjour <strong>{firstName}</strong>,
    </p>
    <p style="font-size:15px;line-height:1.6;">
      Après <strong>{daysInactive} jours</strong> sans commande, votre compte professionnel sur {shopName} a été mis en pause.
    </p>
    <div style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:16px 18px;margin:20px 0;">
      <p style="margin:0 0 8px;color:#1E293B;font-size:14px;line-height:1.6;">
        <strong>Ce que cela change :</strong>
      </p>
      <ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.7;">
        <li>Vous pouvez toujours vous connecter et parcourir le site</li>
        <li>Les tarifs pro et le bouton de commande ne sont plus visibles</li>
        <li>Pour réactiver votre compte, il suffit de nous contacter — un administrateur le rouvrira rapidement</li>
      </ul>
    </div>
    <p style="font-size:15px;line-height:1.6;">
      Si vous souhaitez retrouver votre accès complet, contactez notre service client via le chat en ligne ou par email à <a href="mailto:{shopEmail}" style="color:#1A1A1A;">{shopEmail}</a>.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="{supportUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Contacter le service client →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // CLIENT — commandes
  // Les 5 statuts partagent la même ossature (header coloré + items + totaux)
  // mais chacun garde ses propres phrases et son propre bloc dynamique.
  // ─────────────────────────────────────────────
  ORDER_CREATED: {
    subject: "{shopName} — Confirmation de votre commande {orderNumber}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#1A1A1A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🧾</div>
    <h2 style="margin:0;font-size:20px;">Merci pour votre commande</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Nous avons bien reçu votre commande <strong>{orderNumber}</strong>. Elle sera prise en charge par notre équipe dans les plus brefs délais. Vous recevrez un email dès qu'elle sera expédiée.
    </p>
    <div style="margin-top:24px;">
      <h3 style="font-size:14px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Récapitulatif de votre commande</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Cet email a été envoyé automatiquement suite à la mise à jour de votre commande.
  </p>
</div>`,
  },

  ORDER_BANK_TRANSFER_PENDING: {
    subject: "{shopName} — Commande {orderNumber} en attente de votre virement",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#D97706;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🏦</div>
    <h2 style="margin:0;font-size:20px;">Merci pour votre commande</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Nous avons bien enregistré votre commande <strong>{orderNumber}</strong>. Pour finaliser, il vous reste à effectuer votre virement bancaire aux coordonnées ci-dessous. La commande sera préparée et expédiée dès réception du virement.
    </p>
    {bankTransferHtml}
    <div style="margin-top:24px;">
      <h3 style="font-size:14px;color:#6B6B6B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Récapitulatif de votre commande</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique.
  </p>
</div>`,
  },

  ORDER_VALIDATED: {
    subject: "{shopName} — Votre commande {orderNumber} est prête à être expédiée",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#2563EB;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">✅</div>
    <h2 style="margin:0;font-size:20px;">Votre commande a été validée</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre commande <strong>{orderNumber}</strong> a été validée par notre équipe et est prête à être expédiée. Vous recevrez un nouvel email dès qu'elle sera envoyée.
    </p>
    {adjustmentsHtml}
    <div style="margin-top:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#2563EB;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique.
  </p>
</div>`,
  },

  ORDER_BANK_TRANSFER_CONFIRMED: {
    subject: "{shopName} — Virement reçu, commande {orderNumber} en préparation",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#059669;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">✅</div>
    <h2 style="margin:0;font-size:20px;">Nous avons bien reçu votre virement</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre virement pour la commande <strong>{orderNumber}</strong> a bien été reçu. Elle est désormais en cours de préparation et sera expédiée sous peu — vous recevrez un email dès qu'elle sera en route.
    </p>
    <div style="margin-top:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#059669;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique.
  </p>
</div>`,
  },

  ORDER_SHIPPED: {
    subject: "{shopName} — Commande {orderNumber} expédiée",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#374151;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🚚</div>
    <h2 style="margin:0;font-size:20px;">Votre commande a été expédiée</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre commande <strong>{orderNumber}</strong> a été expédiée ! Elle est en route vers votre adresse de livraison.
    </p>
    {trackingHtml}
    <div style="margin-top:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#374151;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique.
  </p>
</div>`,
  },

  ORDER_CANCELLED: {
    subject: "{shopName} — Commande {orderNumber} annulée",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#DC2626;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">❌</div>
    <h2 style="margin:0;font-size:20px;">Votre commande a été annulée</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre commande <strong>{orderNumber}</strong> a été annulée. Si vous avez des questions, n'hésitez pas à nous contacter.
    </p>
    <div style="margin-top:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#F7F7F8;">
            <th style="padding:8px 12px;text-align:left;">Produit</th>
            <th style="padding:8px 12px;text-align:center;">Qté</th>
            <th style="padding:8px 12px;text-align:right;">Total HT</th>
          </tr>
        </thead>
        <tbody>{itemsHtml}</tbody>
      </table>
      {totalsHtml}
    </div>
    <div style="text-align:center;margin-top:28px;">
      <a href="{orderUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique.
  </p>
</div>`,
  },

  ORDER_MODIFIED: {
    subject: "{shopName} — Modification de votre commande {orderNumber}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#F59E0B;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:32px;margin-bottom:8px;">📝</div>
    <h2 style="margin:0;font-size:20px;">Modification de commande</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour{clientCompany},</p>
    <p style="font-size:15px;line-height:1.6;">
      Nous avons dû ajuster certains articles de votre commande <strong>{orderNumber}</strong> :
    </p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px;">
      <thead>
        <tr style="background:#F7F7F8;">
          <th style="padding:8px 12px;text-align:left;">Article</th>
          <th style="padding:8px 12px;text-align:center;">Quantité</th>
          <th style="padding:8px 12px;text-align:right;">Avoir HT</th>
        </tr>
      </thead>
      <tbody>{modificationsHtml}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #1A1A1A;">
          <td colspan="2" style="padding:8px 12px;font-weight:bold;">Total avoir</td>
          <td style="padding:8px 12px;text-align:right;font-weight:bold;">{totalCredit} €</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin-top:20px;font-size:14px;color:#4B5563;">
      Le montant correspondant vous sera remboursé ou crédité prochainement.
    </p>
    <div style="text-align:center;margin-top:24px;">
      <a href="{orderUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir ma commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // CLIENT — paiement
  // ─────────────────────────────────────────────
  CHECKOUT_PAYMENT_LINK: {
    subject: "{shopName} — Votre lien de paiement sécurisé ({amountStr} €)",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#0F172A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:32px;margin-bottom:8px;">🔒</div>
    <h2 style="margin:0;font-size:20px;">Votre lien de paiement</h2>
    {orderTag}
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">{greeting}</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre commande chez <strong>{shopName}</strong> a été enregistrée. Pour la régler, cliquez sur le bouton ci-dessous — vous serez redirigé vers la page sécurisée de notre prestataire Stripe.
    </p>
    <div style="background:#F7F7F8;border:1px solid #E5E5E5;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
      <div style="font-size:12px;color:#6B6B6B;text-transform:uppercase;letter-spacing:1px;">Montant à régler</div>
      <div style="font-size:28px;font-weight:bold;margin-top:4px;">{amountStr} €</div>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="{checkoutUrl}" style="background:#0F172A;color:#ffffff;padding:14px 32px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;font-size:15px;">
        Payer maintenant →
      </a>
    </div>
    <p style="font-size:12px;color:#6B6B6B;text-align:center;line-height:1.5;">
      Lien valable jusqu'au <strong>{expiresStr}</strong>.<br/>
      Si le bouton ne fonctionne pas, copiez-collez cette adresse dans votre navigateur :<br/>
      <span style="word-break:break-all;color:#334155;">{checkoutUrl}</span>
    </p>
    <p style="font-size:12px;color:#6B6B6B;text-align:center;margin-top:16px;">
      Ce lien est aussi accessible depuis votre espace commandes tant que la commande reste en attente de paiement.
    </p>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  ORDER_SUPPLEMENT_REQUEST: {
    subject: "{shopName} — Complément à régler sur votre commande {orderNumber} ({amountStr} €)",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#0F172A;color:#fff;padding:24px;border-radius:8px 8px 0 0;text-align:center;">
    <div style="font-size:32px;margin-bottom:8px;">🧾</div>
    <h2 style="margin:0;font-size:20px;">Complément à régler</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:13px;">Commande {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;">Bonjour,</p>
    <p style="font-size:15px;line-height:1.6;">
      Votre commande chez <strong>{shopName}</strong> a été ajustée (ajout d'un article, modification de quantité). Un
      <strong>complément de {amountStr} €</strong> reste à régler pour finaliser la préparation.
    </p>
    <div style="background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
      <div style="font-size:12px;color:#1E40AF;text-transform:uppercase;letter-spacing:1px;">Montant restant à régler</div>
      <div style="font-size:28px;font-weight:bold;margin-top:4px;color:#1E3A8A;">{amountStr} €</div>
    </div>
    {paymentBlock}
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Email automatique, ne pas répondre.
  </p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // CLIENT — service client
  // ─────────────────────────────────────────────
  SUPPORT_REPLY: {
    subject: "Un administrateur vous a répondu — {shopName} | Service Client",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#1A1A1A;">{greeting}</h2>
  <p>Un administrateur vous a répondu sur votre Service Client.</p>
  <p>Connectez-vous à votre espace pour lire sa réponse et lui répondre.</p>
  <a href="{conversationUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:12px;">
    Voir la conversation
  </a>
  <p style="color:#71717A;font-size:12px;margin-top:24px;">
    Vous recevez ce message parce que vous avez ouvert une conversation avec le Service Client de {shopName}.
  </p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // ADMIN — clients
  // ─────────────────────────────────────────────
  ADMIN_NEW_REGISTRATION: {
    subject: "Nouvelle inscription client — {company} ({statusLabel})",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <h2 style="color:#1A1A1A;border-bottom:2px solid #E5E7EB;padding-bottom:10px;">
    Nouvelle demande d'inscription
  </h2>
  <p>Un nouveau client vient de s'inscrire sur la plateforme B2B {shopName}.</p>
  {statusBlock}
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">
    <tr style="background:#F3F4F6;">
      <td style="padding:10px 14px;font-weight:bold;width:40%;">Prénom / Nom</td>
      <td style="padding:10px 14px;">{firstName} {lastName}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:bold;">Société</td>
      <td style="padding:10px 14px;">{company}</td>
    </tr>
    <tr style="background:#F3F4F6;">
      <td style="padding:10px 14px;font-weight:bold;">Email</td>
      <td style="padding:10px 14px;">{email}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;font-weight:bold;">Téléphone</td>
      <td style="padding:10px 14px;">{phone}</td>
    </tr>
    <tr style="background:#F3F4F6;">
      <td style="padding:10px 14px;font-weight:bold;">SIRET</td>
      <td style="padding:10px 14px;">{siret}</td>
    </tr>
    {messageBlock}
  </table>
  {kbisNote}
  {docNote}
  <div style="margin-top:20px;">
    <a href="{adminUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 24px;text-decoration:none;font-weight:bold;display:inline-block;">
      Examiner le dossier →
    </a>
  </div>
  <p style="margin-top:24px;color:#9CA3AF;font-size:12px;">
    {shopName} — Administration
  </p>
</div>`,
  },

  ADMIN_NEW_MESSAGE: {
    subject: "Nouveau message de {clientCompany} — {subject}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#1A1A1A;">Nouveau message</h2>
  <p><strong>{clientName}</strong> ({clientCompany}) vous a envoyé un message :</p>
  <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
    <p style="margin:0;color:#333;">{messagePreview}</p>
  </div>
  <a href="{adminUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
    Voir la conversation
  </a>
</div>`,
  },

  ADMIN_CLIENT_REPLIED: {
    subject: "{clientName} vous a répondu — {shopName} | Service Client",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#1A1A1A;">Nouvelle réponse</h2>
  <p>{clientName}{companySuffix} vous a répondu dans sa conversation en direct.</p>
  <p>Connectez-vous à l'espace admin pour lire son message et lui répondre.</p>
  <a href="{conversationUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:12px;">
    Voir la conversation
  </a>
</div>`,
  },

  ADMIN_NEW_CLAIM: {
    subject: "Nouvelle demande (Service Client) {claimReference} — {clientCompany}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#1A1A1A;">Nouvelle demande — Service Client</h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px;font-weight:bold;">Référence</td><td style="padding:8px;">{claimReference}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;">Client</td><td style="padding:8px;">{clientName} ({clientCompany})</td></tr>
    {orderRow}
    <tr><td style="padding:8px;font-weight:bold;">Sujet</td><td style="padding:8px;">{subject}</td></tr>
  </table>
  {reportedItemsBlock}
  <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
    <p style="margin:0;color:#333;white-space:pre-wrap;">{messagePreview}</p>
  </div>
  <a href="{claimUrl}" style="display:inline-block;background:#1A1A1A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
    Ouvrir la conversation
  </a>
</div>`,
  },

  // ─────────────────────────────────────────────
  // ADMIN — commandes
  // ─────────────────────────────────────────────
  ADMIN_NEW_ORDER: {
    subject: "🛒 Nouvelle commande {orderNumber} — {clientLabel}",
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#1A1A1A;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">🛒 Nouvelle commande reçue</h2>
    <p style="margin:6px 0 0;opacity:0.85;font-size:13px;">N° {orderNumber}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
      <strong>{clientLabel}</strong> vient de passer commande.
    </p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
      Montant total : <strong>{totalTTC} € TTC</strong>
    </p>
    <div style="text-align:center;">
      <a href="{orderUrl}" style="background:#1A1A1A;color:#ffffff;padding:12px 28px;text-decoration:none;font-weight:bold;display:inline-block;border-radius:8px;">
        Voir la commande →
      </a>
    </div>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Notification automatique
  </p>
</div>`,
  },

  // ─────────────────────────────────────────────
  // ADMIN — sécurité
  // ─────────────────────────────────────────────
  ADMIN_LOGIN_NOTIFICATION: {
    subject: "🔐 Nouvelle connexion admin — {shopName}",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
  <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
    <div style="background:#EEF2FF;padding:20px 24px;border-bottom:1px solid #C7D2FE">
      <div style="font-size:11px;color:#4338CA;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">{shopName} · Sécurité</div>
      <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">🔐 Nouvelle connexion admin</div>
    </div>
    <div style="padding:28px 24px">
      <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px">
        Une connexion vient d'être effectuée sur l'espace admin de <strong>{shopName}</strong>.
      </p>
      <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;margin:8px 0 20px">
        <tr><td style="padding:6px 0;color:#64748B;width:130px">Compte :</td><td style="padding:6px 0"><strong>{adminEmail}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Date :</td><td style="padding:6px 0">{when} (heure de Paris)</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Adresse IP :</td><td style="padding:6px 0">{ip}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Navigateur :</td><td style="padding:6px 0">{browser}</td></tr>
      </table>
      <div style="background:#FFFBEB;border:1px solid #FED7AA;border-radius:10px;padding:14px 16px;margin:20px 0">
        <div style="font-size:13px;color:#78350F;line-height:1.5">
          <strong>⚠️ Ce n'était pas vous ?</strong><br />
          Changez immédiatement votre mot de passe admin depuis les paramètres et vérifiez qu'aucune commande ou modification suspecte n'a été passée.
        </div>
      </div>
      <p style="font-size:11px;color:#94A3B8;margin:16px 0 0">
        Cet e-mail est envoyé automatiquement à chaque connexion réussie sur votre compte admin.
      </p>
    </div>
  </div>
  <p style="font-size:11px;color:#94A3B8;text-align:center;padding:12px 24px;margin:0">
    {shopName} — Notification de sécurité automatique
  </p>
</div>`,
  },

  ADMIN_PAYMENT_ERROR: {
    subject: "⚠️ Bug paiement {shopName} — {whenShort} — {clientLabel}",
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#1A1A1A;background:#F1F5F9;padding:16px">
  <div style="background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.06)">
    <div style="background:#FEE2E2;padding:20px 24px;border-bottom:1px solid #FCA5A5">
      <div style="font-size:11px;color:#991B1B;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">{shopName} · Bug paiement</div>
      <div style="font-size:18px;font-weight:700;color:#0F172A;margin-top:8px;line-height:1.3">⚠️ Un client n'a pas pu payer</div>
    </div>
    <div style="padding:28px 24px">
      <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 16px">
        Un client de <strong>{shopName}</strong> a rencontré un bug technique en essayant de payer.
      </p>
      <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;margin:8px 0 20px">
        <tr><td style="padding:6px 0;color:#64748B;width:170px">Client :</td><td style="padding:6px 0"><strong>{clientLabel}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Société :</td><td style="padding:6px 0">{clientCompany}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Date :</td><td style="padding:6px 0">{when} (heure de Paris)</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Étape :</td><td style="padding:6px 0">{stageLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Origine :</td><td style="padding:6px 0">{sourceLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Montant :</td><td style="padding:6px 0">{amount}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">PaymentIntent :</td><td style="padding:6px 0"><code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px">{paymentIntentId}</code></td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Commande :</td><td style="padding:6px 0"><code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px">{orderId}</code></td></tr>
        <tr><td style="padding:6px 0;color:#64748B">Navigateur :</td><td style="padding:6px 0">{browser}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B">IP :</td><td style="padding:6px 0">{ip}</td></tr>
      </table>
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin:16px 0">
        <div style="font-size:11px;color:#991B1B;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Erreur technique (côté Stripe)</div>
        <div style="font-size:13px;color:#450A0A;font-family:'Courier New',monospace;line-height:1.7">{errorLines}</div>
      </div>
      <p style="font-size:12px;color:#94A3B8;margin:20px 0 0;line-height:1.5">
        Cette alerte n'est envoyée qu'une fois par 5 minutes pour un même client et une même erreur — les tentatives répétées ne créent pas de spam.
      </p>
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#94A3B8;margin:16px 0 0">
    Notification automatique — ne pas répondre à cet email.
  </p>
</div>`,
  },

  ADMIN_ORPHAN_PAYMENT_INTENT: {
    subject: "⚠️ Paiement orphelin {amount} € — {paymentIntentId}",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#B91C1C;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">⚠️ Paiement Stripe orphelin détecté</h2>
    <p style="margin:6px 0 0;opacity:0.9;font-size:13px;">{tenantName}</p>
  </div>
  <div style="background:#FFFFFF;padding:24px;border:1px solid #E5E5E5;border-top:none;">
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">
      Un client a été <strong>débité de {amount} €</strong> mais aucune commande n'apparaît côté boutique.
    </p>
    <table style="width:100%;font-size:13px;line-height:1.6;margin:0 0 16px;border-collapse:collapse;">
      <tr><td style="padding:4px 0;color:#666;">PaymentIntent</td><td style="padding:4px 0;font-family:monospace;">{paymentIntentId}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Montant</td><td style="padding:4px 0;">{amount} €</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Email client</td><td style="padding:4px 0;">{receiptEmail}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">Date paiement</td><td style="padding:4px 0;">{paymentDate}</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#B91C1C;">
      <strong>Action requise :</strong> vérifiez si une commande a été créée manuellement côté admin. Sinon, connectez-vous au dashboard Stripe pour rembourser le client OU créer la commande recovery.
    </p>
    <p style="font-size:12px;color:#666;margin:0;">
      Cette alerte se répète chaque 24h tant que le PaymentIntent reste orphelin.
    </p>
  </div>
  <p style="color:#9CA3AF;font-size:11px;padding:12px 24px;text-align:center;">
    {shopName} — Alerte automatique (tenant : {tenantSlug})
  </p>
</div>`,
  },
};
