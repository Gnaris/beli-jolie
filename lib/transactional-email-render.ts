/**
 * Résolution d'un mail transactionnel : override admin (DB) → fallback défaut
 * (code), avec interpolation des variables dynamiques et cascade de locale.
 *
 * Appelé par CHAQUE fonction d'envoi transactionnelle (lib/notifications.ts,
 * lib/password-reset.ts, lib/login-otp.ts, lib/email-change.ts,
 * lib/admin-login-notify.ts, lib/payment-error-notify.ts,
 * lib/orphan-payment-intents-worker.ts).
 *
 * Comportement :
 *  1. Récupère l'override en BDD pour (tenant courant, scenarioKey, locale).
 *  2. Si une version localisée (locale ≠ "fr") existe avec un `html` non vide,
 *     l'utilise. Sinon retombe sur la version FR de l'override.
 *  3. Si aucun override existe, utilise `TRANSACTIONAL_DEFAULTS[scenarioKey]`.
 *  4. Interpole tous les `{token}` du subject et du HTML avec le `vars`.
 *     Tokens absents = conservés tels quels (visibles → repérables).
 *  5. Fire-and-forget : toute erreur BDD retombe silencieusement sur le défaut
 *     code — le mail doit TOUJOURS partir, même si Prisma est en panne.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  TRANSACTIONAL_DEFAULTS,
  type TransactionalEmailTemplate,
} from "@/lib/transactional-email-defaults";
import type { TransactionalScenarioKey } from "@/lib/transactional-email-scenarios";
import { TRANSACTIONAL_LOCALES } from "@/lib/transactional-email-scenarios";

/* ─────────────────────────────────────────────
   Interpolation (identique à mail-merge pour cohérence éditeur / envoi)
   ───────────────────────────────────────────── */

export type MailMergeVars = Record<string, string | number | null | undefined>;

/**
 * Remplace tous les `{token}` par leur valeur. Tokens inconnus = conservés
 * (visibles dans le mail — repérables à la relecture, pas de « blank silencieux »).
 * NB : les valeurs sont injectées telles quelles. L'appelant est responsable
 * d'avoir déjà échappé le HTML des pièces dynamiques (ex. `escapeHtml(firstName)`).
 */
export function interpolateTemplate(input: string, vars: MailMergeVars): string {
  if (!input) return input;
  return input.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, token: string) => {
    const value = vars[token];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/* ─────────────────────────────────────────────
   Lecture de l'override en BDD
   ───────────────────────────────────────────── */

function isSupportedLocale(locale: string): boolean {
  return (TRANSACTIONAL_LOCALES as readonly string[]).includes(locale);
}

/**
 * Charge un override pour (scenarioKey, locale demandée). L'extension Prisma
 * `prisma-tenant-scope.ts` scope automatiquement sur le tenant courant via ALS.
 * Retourne la version localisée si elle existe et non vide, sinon FR.
 */
export async function getTransactionalOverride(
  scenarioKey: TransactionalScenarioKey,
  locale: string = "fr",
): Promise<TransactionalEmailTemplate | null> {
  try {
    const override = await prisma.transactionalEmailOverride.findFirst({
      where: { scenarioKey },
      include: {
        locales: isSupportedLocale(locale) && locale !== "fr" ? { where: { locale } } : false,
      },
    });

    if (!override) return null;

    // Locale ≠ FR demandée : retombe sur FR si pas de ligne OU si html vide.
    if (locale !== "fr" && isSupportedLocale(locale)) {
      const localized = override.locales?.[0];
      if (localized && localized.html && localized.html.trim().length > 0) {
        return { subject: localized.subject, html: localized.html };
      }
      // fallback FR
    }

    return { subject: override.subject, html: override.html };
  } catch (err) {
    logger.warn("[transactional-render] Lecture override impossible, fallback défaut", {
      scenarioKey,
      locale,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/* ─────────────────────────────────────────────
   Rendu complet (sujet + HTML) prêt à passer à sendMail()
   ───────────────────────────────────────────── */

export interface RenderedTransactionalEmail {
  subject: string;
  html: string;
  /** Source retenue, utile pour les tests et les logs. */
  source: "override" | "default";
}

/**
 * Charge le template actif (override ou défaut), interpole les variables, et
 * renvoie `{ subject, html }` prêt à passer à `sendMail()`.
 */
export async function renderTransactionalEmail(params: {
  scenarioKey: TransactionalScenarioKey;
  locale?: string;
  vars: MailMergeVars;
}): Promise<RenderedTransactionalEmail> {
  const locale = params.locale ?? "fr";
  const override = await getTransactionalOverride(params.scenarioKey, locale);
  const template = override ?? TRANSACTIONAL_DEFAULTS[params.scenarioKey];
  return {
    subject: interpolateTemplate(template.subject, params.vars),
    html: interpolateTemplate(template.html, params.vars),
    source: override ? "override" : "default",
  };
}

/* ─────────────────────────────────────────────
   Lecture pour l'UI éditeur
   ───────────────────────────────────────────── */

/**
 * Récupère le modèle actif (override OU défaut) pour l'éditeur admin, pour
 * la locale demandée. Retourne aussi un flag `customized` indiquant si c'est
 * la version admin (true) ou le défaut (false). Pas d'interpolation (on
 * garde les `{token}` pour édition).
 */
export async function getTransactionalTemplateForEditor(params: {
  scenarioKey: TransactionalScenarioKey;
  locale?: string;
}): Promise<{ subject: string; html: string; customized: boolean }> {
  const locale = params.locale ?? "fr";
  const override = await getTransactionalOverride(params.scenarioKey, locale);
  if (override) {
    return { subject: override.subject, html: override.html, customized: true };
  }
  const def = TRANSACTIONAL_DEFAULTS[params.scenarioKey];
  return { subject: def.subject, html: def.html, customized: false };
}
