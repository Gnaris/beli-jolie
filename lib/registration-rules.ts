/**
 * Règles d'inscription auto-approuvée.
 *
 * ── ZONE FRANCE : modèle à niveaux (tier) ────────────────────────────
 * 3 champs configurables : SIRET, TVA, KBIS.
 *   - SIRET + TVA : chacun avec `requirement` (obligatoire/optionnel) +
 *     `autoVerify` (vérification en ligne annuaire-entreprises / VIES).
 *     Ces deux champs peuvent être « validés » car on les vérifie contre
 *     un registre officiel.
 *   - KBIS : `requirement` (obligatoire/optionnel). Pas de vérif possible
 *     car c'est une pièce jointe PDF/image dont on ne peut pas prouver
 *     l'authenticité. Le KBIS ne compte donc PAS comme critère « validé » ;
 *     il n'a de poids que dans le niveau « all » comme bonus de confiance.
 * Les décisions sont posées par **niveaux** (le plus strict matché gagne,
 * ordre évalué de haut en bas) :
 *   - « SIRET valide ET TVA valide ET KBIS joint »       → `all`
 *   - « SIRET valide ET TVA valide » (KBIS indifférent)  → `siretAndVat`
 *   - « SIRET valide OU TVA valide »                     → `anyOne`
 *   - « ni SIRET valide, ni TVA valide »                 → `none`
 *
 * ── ZONES UE / INTERNATIONAL : modèle par champ (field) ───────────────
 * 1 seul champ configurable (TVA pour UE, N° entreprise pour WORLD).
 * Décisions classiques onValid / onInvalid / onMissing.
 *
 * ── GESTION DES PANNES ──────────────────────────────────────────────
 * Si un service de vérification est KO (annuaire ou VIES down), on force
 * le statut en PENDING + flag `serviceErrored` — on ne refuse jamais un
 * dossier à cause d'une panne d'infrastructure externe.
 *
 * ── STOCKAGE ─────────────────────────────────────────────────────────
 * JSON dans SiteConfig[registration_rules]. Par défaut, tout en PENDING
 * (comportement historique : validation manuelle de chaque dossier).
 */
import type { CompanyZone } from "@/lib/vat";

export const REGISTRATION_RULES_KEY = "registration_rules";

export type RegistrationDecision = "approve" | "pending" | "reject";
export type FiscalRequirement = "required" | "optional";

/* ─── Zone France (tier) ──────────────────────────────────────────── */
export interface FrFieldWithVerify {
  requirement: FiscalRequirement;
  autoVerify: boolean;
}
export interface FrFieldDocument {
  requirement: FiscalRequirement;
}
export interface FrTierDecisions {
  /** Les 3 champs validés : SIRET valide + TVA valide + KBIS joint. */
  all: RegistrationDecision;
  /** SIRET valide + TVA valide (KBIS indifférent). */
  siretAndVat: RegistrationDecision;
  /** SIRET valide OU TVA valide. KBIS ne compte pas (pas vérifiable). */
  anyOne: RegistrationDecision;
  /** Ni SIRET ni TVA valide. KBIS joint ne sauve pas le dossier. */
  none: RegistrationDecision;
}
export interface FrZoneRule {
  siret: FrFieldWithVerify;
  vat: FrFieldWithVerify;
  kbis: FrFieldDocument;
  decisions: FrTierDecisions;
}

/* ─── Zones UE / WORLD (field) ────────────────────────────────────── */
export interface FieldRule {
  requirement: FiscalRequirement;
  autoVerify: boolean;
  onValid: RegistrationDecision;
  onInvalid: RegistrationDecision;
  onMissing: RegistrationDecision;
}
export interface EuZoneRule {
  vat: FieldRule;
}
export interface WorldZoneRule {
  brn: FieldRule;
}

export interface RegistrationRules {
  fr: FrZoneRule;
  eu: EuZoneRule;
  world: WorldZoneRule;
}

/* ─── Défauts ─────────────────────────────────────────────────────── */
const DEFAULT_FIELD_RULE: FieldRule = {
  requirement: "required",
  autoVerify: false,
  onValid: "pending",
  onInvalid: "pending",
  onMissing: "pending",
};

export const DEFAULT_RULES: RegistrationRules = {
  fr: {
    siret: { requirement: "required", autoVerify: false },
    vat: { requirement: "optional", autoVerify: false },
    kbis: { requirement: "optional" },
    decisions: {
      all: "pending",
      siretAndVat: "pending",
      anyOne: "pending",
      none: "pending",
    },
  },
  eu: {
    vat: { ...DEFAULT_FIELD_RULE, requirement: "required" },
  },
  world: {
    brn: { ...DEFAULT_FIELD_RULE, requirement: "optional", autoVerify: false },
  },
};

function isDecision(v: unknown): v is RegistrationDecision {
  return v === "approve" || v === "pending" || v === "reject";
}
function isFiscalRequirement(v: unknown): v is FiscalRequirement {
  return v === "required" || v === "optional";
}
function normalizeRequirement(v: unknown): FiscalRequirement | null {
  const normalized = v === "none" ? "optional" : v;
  return isFiscalRequirement(normalized) ? normalized : null;
}

function parseFieldWithVerify(raw: unknown, fallback: FrFieldWithVerify): FrFieldWithVerify {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    requirement: normalizeRequirement(r.requirement ?? r.fiscalNumber) ?? fallback.requirement,
    autoVerify: typeof r.autoVerify === "boolean" ? r.autoVerify : fallback.autoVerify,
  };
}
function parseFieldDocument(raw: unknown, fallback: FrFieldDocument): FrFieldDocument {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    requirement: normalizeRequirement(r.requirement) ?? fallback.requirement,
  };
}
function parseTierDecisions(raw: unknown, fallback: FrTierDecisions): FrTierDecisions {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    all: isDecision(r.all) ? r.all : fallback.all,
    siretAndVat: isDecision(r.siretAndVat) ? r.siretAndVat : fallback.siretAndVat,
    anyOne: isDecision(r.anyOne) ? r.anyOne : fallback.anyOne,
    none: isDecision(r.none) ? r.none : fallback.none,
  };
}
function parseFieldRule(raw: unknown, fallback: FieldRule, forceNoAutoVerify: boolean): FieldRule {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    requirement: normalizeRequirement(r.requirement ?? r.fiscalNumber) ?? fallback.requirement,
    autoVerify: forceNoAutoVerify ? false : typeof r.autoVerify === "boolean" ? r.autoVerify : fallback.autoVerify,
    onValid: isDecision(r.onValid) ? r.onValid : fallback.onValid,
    onInvalid: isDecision(r.onInvalid) ? r.onInvalid : fallback.onInvalid,
    onMissing: isDecision(r.onMissing) ? r.onMissing : fallback.onMissing,
  };
}

/**
 * Parse la valeur brute de SiteConfig[registration_rules]. Tolérant à
 * l'ancien schéma (per-field pour FR) : les champs siret/vat sont lus
 * à l'identique, les décisions par champ sont remappées en tier par défaut.
 */
export function parseRegistrationRules(raw: string | null | undefined): RegistrationRules {
  if (!raw) return DEFAULT_RULES;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const frRaw = (data.fr ?? {}) as Record<string, unknown>;
    const euRaw = (data.eu ?? {}) as Record<string, unknown>;
    const worldRaw = (data.world ?? {}) as Record<string, unknown>;
    return {
      fr: {
        siret: parseFieldWithVerify(frRaw.siret ?? frRaw, DEFAULT_RULES.fr.siret),
        vat: parseFieldWithVerify(frRaw.vat, DEFAULT_RULES.fr.vat),
        kbis: parseFieldDocument(frRaw.kbis, DEFAULT_RULES.fr.kbis),
        decisions: parseTierDecisions(frRaw.decisions, DEFAULT_RULES.fr.decisions),
      },
      eu: {
        vat: parseFieldRule(euRaw.vat ?? euRaw, DEFAULT_RULES.eu.vat, false),
      },
      world: {
        brn: parseFieldRule(worldRaw.brn ?? worldRaw, DEFAULT_RULES.world.brn, true),
      },
    };
  } catch {
    return DEFAULT_RULES;
  }
}

export function serializeRegistrationRules(rules: RegistrationRules): string {
  return JSON.stringify({
    fr: {
      siret: rules.fr.siret,
      vat: rules.fr.vat,
      kbis: rules.fr.kbis,
      decisions: rules.fr.decisions,
    },
    eu: { vat: rules.eu.vat },
    world: { brn: { ...rules.world.brn, autoVerify: false } },
  });
}

/** Mappe la zone BDD vers la clé des règles. */
export function zoneToRulesKey(zone: CompanyZone): keyof RegistrationRules {
  if (zone === "FR") return "fr";
  if (zone === "EU") return "eu";
  return "world";
}

export function zoneFiscalLabel(zone: CompanyZone): string {
  if (zone === "FR") return "SIRET, TVA ou KBIS";
  if (zone === "EU") return "n° de TVA intracommunautaire";
  return "numéro d'entreprise";
}

/* ─── Entrée / sortie de la décision ─────────────────────────────── */
export interface FieldCheck {
  provided: boolean;
  /**
   * - true  → service a confirmé valide
   * - false → service a confirmé invalide
   * - null  → vérification désactivée OU service KO (traité comme panne
   *           seulement si autoVerify est actif)
   */
  verifiedValid: boolean | null;
}

export interface DecisionInput {
  /** Zone FR : SIRET + TVA + KBIS (KBIS n'a pas de verifiedValid). */
  siret?: FieldCheck;
  vat?: FieldCheck;
  kbisAttached?: boolean;
  /** Zone WORLD. */
  brn?: FieldCheck;
}

export type RegistrationStatusDecision =
  | { kind: "missingFiscalRejected"; missingFields: string[] }
  | {
      kind: "status";
      status: "APPROVED" | "PENDING" | "REJECTED";
      serviceErrored?: boolean;
    };

type Status = "APPROVED" | "PENDING" | "REJECTED";

function toStatus(d: RegistrationDecision): Status {
  if (d === "approve") return "APPROVED";
  if (d === "reject") return "REJECTED";
  return "PENDING";
}

/* ─── Décision par champ (EU + WORLD) ─────────────────────────────── */
function decideFieldRule(
  rule: FieldRule,
  check: FieldCheck,
): { kind: "missing" } | { kind: "status"; status: Status; serviceErrored?: boolean } {
  if (!check.provided) {
    if (rule.requirement === "required") return { kind: "missing" };
    return { kind: "status", status: toStatus(rule.onMissing) };
  }
  if (!rule.autoVerify) return { kind: "status", status: toStatus(rule.onValid) };
  if (check.verifiedValid === true) return { kind: "status", status: toStatus(rule.onValid) };
  if (check.verifiedValid === false) return { kind: "status", status: toStatus(rule.onInvalid) };
  // Service KO → fallback sécurisé.
  return { kind: "status", status: "PENDING", serviceErrored: true };
}

/* ─── Décision à niveaux pour la France ───────────────────────────── */

/** Un champ compte comme « OK au niveau tier » quand :
 *  - il est fourni ET
 *  - soit la vérif auto est OFF (on fait confiance au format), soit la
 *    vérif confirme valide. Un service down → PAS valide (on tombera dans
 *    un tier plus bas, et serviceErrored sera posé si résultat PENDING).
 */
function isFieldOk(field: FrFieldWithVerify, check: FieldCheck): boolean {
  if (!check.provided) return false;
  if (!field.autoVerify) return true;
  return check.verifiedValid === true;
}

function decideFr(
  rules: FrZoneRule,
  input: { siret: FieldCheck; vat: FieldCheck; kbisAttached: boolean },
): { kind: "missing"; fields: string[] } | { kind: "status"; status: Status; serviceErrored?: boolean } {
  // Pré-check : champs obligatoires manquants.
  const missing: string[] = [];
  if (rules.siret.requirement === "required" && !input.siret.provided) missing.push("SIRET");
  if (rules.vat.requirement === "required" && !input.vat.provided) missing.push("TVA");
  if (rules.kbis.requirement === "required" && !input.kbisAttached) missing.push("KBIS");
  if (missing.length > 0) return { kind: "missing", fields: missing };

  const siretOk = isFieldOk(rules.siret, input.siret);
  const vatOk = isFieldOk(rules.vat, input.vat);
  const kbisAttached = input.kbisAttached;

  // Panne détectée : un champ avec autoVerify ON a été fourni mais la vérif
  // a renvoyé null (service KO). Si la décision tombe en PENDING, on remonte
  // le flag pour que l'overlay affiche « service indisponible ».
  const siretServiceDown = rules.siret.autoVerify && input.siret.provided && input.siret.verifiedValid === null;
  const vatServiceDown = rules.vat.autoVerify && input.vat.provided && input.vat.verifiedValid === null;
  const anyServiceDown = siretServiceDown || vatServiceDown;

  // Tier matching (strictest first).
  // Important : le KBIS ne compte PAS comme critère « validé » dans anyOne
  // ou none car on ne peut pas vérifier l'authenticité du document joint.
  // Il n'a de poids qu'en bonus dans le niveau « all » (combiné à des
  // numéros déjà vérifiés en ligne).
  let decision: RegistrationDecision;
  if (siretOk && vatOk && kbisAttached) decision = rules.decisions.all;
  else if (siretOk && vatOk) decision = rules.decisions.siretAndVat;
  else if (siretOk || vatOk) decision = rules.decisions.anyOne;
  else decision = rules.decisions.none;

  const status = toStatus(decision);
  // Service KO + statut final PENDING → promeut le flag serviceErrored.
  if (status === "PENDING" && anyServiceDown) {
    return { kind: "status", status, serviceErrored: true };
  }
  return { kind: "status", status };
}

/**
 * Décide du statut à poser sur un nouveau compte selon la zone + règles +
 * champs fournis / vérifiés. Pure, testable.
 */
export function decideRegistrationStatus(
  zone: CompanyZone,
  rules: RegistrationRules,
  input: DecisionInput,
): RegistrationStatusDecision {
  const emptyCheck: FieldCheck = { provided: false, verifiedValid: null };

  if (zone === "FR") {
    const result = decideFr(rules.fr, {
      siret: input.siret ?? emptyCheck,
      vat: input.vat ?? emptyCheck,
      kbisAttached: input.kbisAttached === true,
    });
    if (result.kind === "missing") {
      return { kind: "missingFiscalRejected", missingFields: result.fields };
    }
    return {
      kind: "status",
      status: result.status,
      ...(result.serviceErrored ? { serviceErrored: true } : {}),
    };
  }

  // Zones UE / WORLD : 1 seul champ.
  const rule = zone === "EU" ? rules.eu.vat : rules.world.brn;
  const check = zone === "EU" ? (input.vat ?? emptyCheck) : (input.brn ?? emptyCheck);
  const fieldLabel = zone === "EU" ? "TVA" : "Numéro d'entreprise";
  const result = decideFieldRule(rule, check);
  if (result.kind === "missing") {
    return { kind: "missingFiscalRejected", missingFields: [fieldLabel] };
  }
  return {
    kind: "status",
    status: result.status,
    ...(result.serviceErrored ? { serviceErrored: true } : {}),
  };
}
