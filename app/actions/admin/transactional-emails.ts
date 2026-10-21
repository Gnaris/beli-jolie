"use server";

/**
 * Server actions pour l'édition des mails transactionnels système
 * (/admin/marketing/mails/systeme).
 *
 * Chaque action :
 *  - exige `requireAdmin()` (session + tenant)
 *  - manipule `TransactionalEmailOverride` + `TransactionalEmailOverrideLocale`
 *  - fait `revalidateTag("transactional-emails-overrides", "default")`
 *    pour que les listings se rafraîchissent.
 */

import { revalidateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  TRANSACTIONAL_SCENARIOS,
  TRANSACTIONAL_LOCALES,
  getScenarioMeta,
  type TransactionalScenarioKey,
  type TransactionalLocale,
} from "@/lib/transactional-email-scenarios";
import { TRANSACTIONAL_DEFAULTS } from "@/lib/transactional-email-defaults";
import { sendMail } from "@/lib/email";
import { interpolateTemplate } from "@/lib/transactional-email-render";
import { getCachedShopName } from "@/lib/cached-data";
import { resolveNotifyEmail } from "@/lib/notifications";

const TAG = "transactional-emails-overrides";

/* ─────────────────────────────────────────────
   Validation
   ───────────────────────────────────────────── */

const SCENARIO_KEYS = TRANSACTIONAL_SCENARIOS.map((s) => s.key) as [
  TransactionalScenarioKey,
  ...TransactionalScenarioKey[],
];

const SaveSchema = z.object({
  scenarioKey: z.enum(SCENARIO_KEYS),
  locale: z.enum(TRANSACTIONAL_LOCALES),
  subject: z.string().trim().min(1, "Le sujet est obligatoire.").max(500),
  html: z.string().min(1, "Le contenu HTML est obligatoire."),
});

const ResetSchema = z.object({
  scenarioKey: z.enum(SCENARIO_KEYS),
  /** `locale` manquant = reset FR (supprime tout l'override + ses locales). */
  locale: z.enum(TRANSACTIONAL_LOCALES).optional(),
});

const SendTestSchema = z.object({
  scenarioKey: z.enum(SCENARIO_KEYS),
  locale: z.enum(TRANSACTIONAL_LOCALES),
  subject: z.string().trim().min(1).max(500),
  html: z.string().min(1),
  /** « self » = envoi à l'admin connecté, « client » = envoi à un client réel. */
  target: z.enum(["self", "client"]),
  /** userId du client cible (obligatoire si target = "client"). */
  targetUserId: z.string().min(1).optional(),
});

/**
 * Tokens à masquer dans les mails de TEST, car ils donnent accès à un compte
 * ou à un paiement. Masqués par `MASKED_VALUE` ci-dessous.
 */
const SENSITIVE_TEST_TOKENS = new Set([
  "code",
  "resetUrl",
  "confirmUrl",
  "checkoutUrl",
]);
const MASKED_VALUE = "XXXXX";

/* ─────────────────────────────────────────────
   Variables obligatoires — garde-fou
   ───────────────────────────────────────────── */

function assertRequiredTokensPresent(
  scenarioKey: TransactionalScenarioKey,
  subject: string,
  html: string,
): string | null {
  const meta = getScenarioMeta(scenarioKey);
  if (!meta) return `Scénario inconnu : ${scenarioKey}`;
  const required = meta.variables.filter((v) => v.required);
  const combined = `${subject}\n${html}`;
  for (const v of required) {
    const re = new RegExp(`\\{${v.token}\\}`);
    if (!re.test(combined)) {
      return `La variable {${v.token}} (${v.label}) est obligatoire pour ce mail — elle doit apparaître dans le sujet ou le contenu.`;
    }
  }
  return null;
}

/* ─────────────────────────────────────────────
   Listing : état de personnalisation par scénario
   ───────────────────────────────────────────── */

export interface ScenarioOverrideState {
  scenarioKey: TransactionalScenarioKey;
  customized: boolean;
  updatedAt: string | null;
  /** Locales qui ont une version non vide en plus du FR. */
  customizedLocales: TransactionalLocale[];
}

export async function listTransactionalOverrides(): Promise<ScenarioOverrideState[]> {
  await requireAdmin();
  const rows = await prisma.transactionalEmailOverride.findMany({
    select: {
      scenarioKey: true,
      updatedAt: true,
      locales: { select: { locale: true, html: true } },
    },
  });
  const byKey = new Map(rows.map((r) => [r.scenarioKey, r]));
  return TRANSACTIONAL_SCENARIOS.map<ScenarioOverrideState>((s) => {
    const row = byKey.get(s.key);
    if (!row) {
      return {
        scenarioKey: s.key,
        customized: false,
        updatedAt: null,
        customizedLocales: [],
      };
    }
    const customizedLocales = row.locales
      .filter((l) => l.html && l.html.trim().length > 0)
      .map((l) => l.locale)
      .filter((loc): loc is TransactionalLocale =>
        (TRANSACTIONAL_LOCALES as readonly string[]).includes(loc),
      );
    return {
      scenarioKey: s.key as TransactionalScenarioKey,
      customized: true,
      updatedAt: row.updatedAt.toISOString(),
      customizedLocales,
    };
  });
}

/* ─────────────────────────────────────────────
   Lecture : template actif pour l'éditeur (locale donnée)
   ───────────────────────────────────────────── */

export async function getTransactionalTemplate(params: {
  scenarioKey: TransactionalScenarioKey;
  locale: TransactionalLocale;
}): Promise<{ subject: string; html: string; customized: boolean }> {
  await requireAdmin();
  const { scenarioKey, locale } = params;

  const override = await prisma.transactionalEmailOverride.findFirst({
    where: { scenarioKey },
    include:
      locale === "fr"
        ? undefined
        : { locales: { where: { locale } } },
  });

  if (!override) {
    const def = TRANSACTIONAL_DEFAULTS[scenarioKey];
    return { subject: def.subject, html: def.html, customized: false };
  }

  if (locale === "fr") {
    return { subject: override.subject, html: override.html, customized: true };
  }

  const localized = override.locales?.[0];
  if (localized && localized.html && localized.html.trim().length > 0) {
    return { subject: localized.subject, html: localized.html, customized: true };
  }
  // Pas de version localisée → on affiche le défaut (pour que la cliente parte
  // d'une base propre, pas de la version FR qu'elle devrait traduire à la main).
  const def = TRANSACTIONAL_DEFAULTS[scenarioKey];
  return { subject: def.subject, html: def.html, customized: false };
}

/* ─────────────────────────────────────────────
   Sauvegarde
   ───────────────────────────────────────────── */

export async function saveTransactionalOverride(input: unknown): Promise<
  { success: true } | { success: false; error: string }
> {
  const { tenant } = await requireAdmin();
  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const { scenarioKey, locale, subject, html } = parsed.data;

  const missing = assertRequiredTokensPresent(scenarioKey, subject, html);
  if (missing) return { success: false, error: missing };

  try {
    if (locale === "fr") {
      // FR vit directement sur la ligne principale.
      const existing = await prisma.transactionalEmailOverride.findFirst({
        where: { scenarioKey },
        select: { id: true },
      });
      if (existing) {
        await prisma.transactionalEmailOverride.update({
          where: { id: existing.id },
          data: { subject, html },
        });
      } else {
        await prisma.transactionalEmailOverride.create({
          data: { tenantId: tenant.id, scenarioKey, subject, html },
        });
      }
    } else {
      // Les autres langues sont des lignes-filles. On a besoin de la ligne
      // principale (FR) comme ancre — s'il n'y en a pas, on la crée avec les
      // valeurs par défaut FR, pour pouvoir attacher la locale.
      let main = await prisma.transactionalEmailOverride.findFirst({
        where: { scenarioKey },
        select: { id: true },
      });
      if (!main) {
        const def = TRANSACTIONAL_DEFAULTS[scenarioKey];
        main = await prisma.transactionalEmailOverride.create({
          data: {
            tenantId: tenant.id,
            scenarioKey,
            subject: def.subject,
            html: def.html,
          },
          select: { id: true },
        });
      }
      const existingLocale = await prisma.transactionalEmailOverrideLocale.findFirst({
        where: { overrideId: main.id, locale },
        select: { id: true },
      });
      if (existingLocale) {
        await prisma.transactionalEmailOverrideLocale.update({
          where: { id: existingLocale.id },
          data: { subject, html },
        });
      } else {
        await prisma.transactionalEmailOverrideLocale.create({
          data: {
            tenantId: tenant.id,
            overrideId: main.id,
            locale,
            subject,
            html,
          },
        });
      }
    }

    revalidateTag(TAG, "default");
    return { success: true };
  } catch (err) {
    logger.error("[transactional-emails] saveTransactionalOverride", { error: err });
    return { success: false, error: "Enregistrement impossible, réessayez." };
  }
}

/* ─────────────────────────────────────────────
   Reset — suppression de l'override (retour au défaut)
   ───────────────────────────────────────────── */

export async function resetTransactionalOverride(input: unknown): Promise<
  { success: true } | { success: false; error: string }
> {
  await requireAdmin();
  const parsed = ResetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const { scenarioKey, locale } = parsed.data;

  try {
    const existing = await prisma.transactionalEmailOverride.findFirst({
      where: { scenarioKey },
      select: { id: true },
    });
    if (!existing) {
      // Déjà au défaut.
      return { success: true };
    }

    if (!locale || locale === "fr") {
      // Reset FR = supprimer tout (y compris locales filles, cascade).
      await prisma.transactionalEmailOverride.delete({ where: { id: existing.id } });
    } else {
      // Reset d'une langue = supprimer uniquement la ligne locale.
      await prisma.transactionalEmailOverrideLocale.deleteMany({
        where: { overrideId: existing.id, locale },
      });
    }

    revalidateTag(TAG, "default");
    return { success: true };
  } catch (err) {
    logger.error("[transactional-emails] resetTransactionalOverride", { error: err });
    return { success: false, error: "Suppression impossible, réessayez." };
  }
}

/* ─────────────────────────────────────────────
   Envoi d'un test (brouillon courant) à l'admin connecté
   ───────────────────────────────────────────── */

export async function sendTransactionalTestEmail(input: unknown): Promise<
  { success: true; sentTo: string } | { success: false; error: string }
> {
  const { session } = await requireAdmin();
  const parsed = SendTestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const { scenarioKey, subject, html, target, targetUserId } = parsed.data;
  const meta = getScenarioMeta(scenarioKey);
  if (!meta) return { success: false, error: "Scénario inconnu." };

  // ── Destinataire : moi-même OU client réel ──
  let to: string | null = null;
  let realClient: {
    firstName: string;
    lastName: string;
    company: string | null;
    email: string;
    phone: string | null;
    siret: string | null;
  } | null = null;

  if (target === "client") {
    if (!targetUserId) {
      return { success: false, error: "Veuillez choisir un client destinataire." };
    }
    const user = await prisma.user.findFirst({
      where: { id: targetUserId },
      select: {
        firstName: true, lastName: true, company: true, email: true,
        phone: true, siret: true,
      },
    });
    if (!user) return { success: false, error: "Client introuvable." };
    to = user.email;
    realClient = user;
  } else {
    const sessionEmail = session.user?.email?.trim();
    to = sessionEmail || (await resolveNotifyEmail());
  }
  if (!to) return { success: false, error: "Aucune adresse de test disponible." };

  // ── Construction des variables ──
  // Base = exemples du registre, puis on écrase par les VRAIES valeurs du
  // client si target=client. Les tokens sensibles sont masqués par XXXXX.
  const shopName = await getCachedShopName();
  const previewVars: Record<string, string> = { shopName };
  for (const v of meta.variables) {
    previewVars[v.token] = v.example;
  }
  if (realClient) {
    previewVars.firstName = realClient.firstName;
    previewVars.lastName = realClient.lastName;
    previewVars.company = realClient.company ?? "";
    previewVars.email = realClient.email;
    if (realClient.phone) previewVars.phone = realClient.phone;
    if (realClient.siret) previewVars.siret = realClient.siret;
    // Petites dérivations utiles pour les mails commandes/support.
    const fullName = `${realClient.firstName} ${realClient.lastName}`.trim();
    previewVars.clientName = fullName || realClient.email;
    previewVars.clientLabel = realClient.company || fullName || realClient.email;
    previewVars.clientCompany = realClient.company
      ? ` <strong>${realClient.company}</strong>`
      : "";
    previewVars.greeting = fullName ? `Bonjour <strong>${fullName}</strong>,` : "Bonjour,";
  }
  // Masque des valeurs sensibles (code OTP, liens de reset / confirmation /
  // paiement). Même en test à soi-même, on les cache pour que la cliente
  // puisse montrer son mail à un prestataire sans fuiter de secret.
  for (const token of SENSITIVE_TEST_TOKENS) {
    if (previewVars[token] !== undefined) {
      previewVars[token] = MASKED_VALUE;
    }
  }

  try {
    const result = await sendMail({
      fromName: shopName,
      to,
      subject: `[TEST — ${meta.label}] ${interpolateTemplate(subject, previewVars)}`,
      html: interpolateTemplate(html, previewVars),
    });
    if (!result.sent) {
      return { success: false, error: "Envoi SMTP échoué (vérifiez la config)." };
    }
    return { success: true, sentTo: to };
  } catch (err) {
    logger.error("[transactional-emails] sendTest", { error: err });
    return { success: false, error: "Envoi impossible." };
  }
}

/* ─────────────────────────────────────────────
   Liste des clients APPROVED pour le picker du modal
   ───────────────────────────────────────────── */

export interface TestEmailClientLite {
  id: string;
  label: string; // "Société — prénom nom (email)" ou fallback email
  email: string;
}

export async function listTestEmailClients(): Promise<TestEmailClientLite[]> {
  await requireAdmin();
  const rows = await prisma.user.findMany({
    where: { role: "CLIENT", status: "APPROVED" },
    orderBy: [{ company: "asc" }, { lastName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
    },
    take: 300,
  });
  return rows.map((u) => {
    const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
    const parts: string[] = [];
    if (u.company?.trim()) parts.push(u.company.trim());
    if (name) parts.push(name);
    const prefix = parts.length > 0 ? parts.join(" — ") : u.email;
    return { id: u.id, email: u.email, label: `${prefix} (${u.email})` };
  });
}
