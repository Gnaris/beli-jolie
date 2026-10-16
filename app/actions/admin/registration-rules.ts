"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setSiteConfig } from "@/lib/site-config-write";
import {
  DEFAULT_RULES,
  REGISTRATION_RULES_KEY,
  parseRegistrationRules,
  serializeRegistrationRules,
  type RegistrationRules,
  type FieldRule,
  type FrFieldWithVerify,
  type FrFieldDocument,
  type FrTierDecisions,
  type FiscalRequirement,
  type RegistrationDecision,
} from "@/lib/registration-rules";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

export async function getRegistrationRules(): Promise<RegistrationRules> {
  const row = await prisma.siteConfig.findFirst({ where: { key: REGISTRATION_RULES_KEY } });
  return parseRegistrationRules(row?.value ?? null);
}

const FISCAL_VALUES = new Set<FiscalRequirement>(["required", "optional"]);
const DECISION_VALUES = new Set<RegistrationDecision>(["approve", "pending", "reject"]);

function sanitizeRequirement(v: unknown, fallback: FiscalRequirement): FiscalRequirement {
  return FISCAL_VALUES.has(v as FiscalRequirement) ? (v as FiscalRequirement) : fallback;
}
function sanitizeDecision(v: unknown, fallback: RegistrationDecision): RegistrationDecision {
  return DECISION_VALUES.has(v as RegistrationDecision) ? (v as RegistrationDecision) : fallback;
}

function sanitizeFrFieldWithVerify(input: unknown, fallback: FrFieldWithVerify): FrFieldWithVerify {
  const r = (input ?? {}) as Record<string, unknown>;
  return {
    requirement: sanitizeRequirement(r.requirement, fallback.requirement),
    autoVerify: Boolean(r.autoVerify),
  };
}
function sanitizeFrFieldDocument(input: unknown, fallback: FrFieldDocument): FrFieldDocument {
  const r = (input ?? {}) as Record<string, unknown>;
  return { requirement: sanitizeRequirement(r.requirement, fallback.requirement) };
}
function sanitizeFrDecisions(input: unknown, fallback: FrTierDecisions): FrTierDecisions {
  const r = (input ?? {}) as Record<string, unknown>;
  return {
    all: sanitizeDecision(r.all, fallback.all),
    siretAndVat: sanitizeDecision(r.siretAndVat, fallback.siretAndVat),
    anyOne: sanitizeDecision(r.anyOne, fallback.anyOne),
    none: sanitizeDecision(r.none, fallback.none),
  };
}
function sanitizeFieldRule(input: unknown, fallback: FieldRule, allowAutoVerify: boolean): FieldRule {
  const r = (input ?? {}) as Record<string, unknown>;
  return {
    requirement: sanitizeRequirement(r.requirement, fallback.requirement),
    autoVerify: allowAutoVerify ? Boolean(r.autoVerify) : false,
    onValid: sanitizeDecision(r.onValid, fallback.onValid),
    onInvalid: sanitizeDecision(r.onInvalid, fallback.onInvalid),
    onMissing: sanitizeDecision(r.onMissing, fallback.onMissing),
  };
}

export async function updateRegistrationRules(
  input: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const data = (input ?? {}) as Record<string, unknown>;
    const fr = (data.fr ?? {}) as Record<string, unknown>;
    const eu = (data.eu ?? {}) as Record<string, unknown>;
    const world = (data.world ?? {}) as Record<string, unknown>;
    const rules: RegistrationRules = {
      fr: {
        siret: sanitizeFrFieldWithVerify(fr.siret, DEFAULT_RULES.fr.siret),
        vat: sanitizeFrFieldWithVerify(fr.vat, DEFAULT_RULES.fr.vat),
        kbis: sanitizeFrFieldDocument(fr.kbis, DEFAULT_RULES.fr.kbis),
        decisions: sanitizeFrDecisions(fr.decisions, DEFAULT_RULES.fr.decisions),
      },
      eu: { vat: sanitizeFieldRule(eu.vat, DEFAULT_RULES.eu.vat, true) },
      world: { brn: sanitizeFieldRule(world.brn, DEFAULT_RULES.world.brn, false) },
    };
    await setSiteConfig(REGISTRATION_RULES_KEY, serializeRegistrationRules(rules));
    revalidatePath("/admin/parametres");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
