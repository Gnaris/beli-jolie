import { describe, it, expect } from "vitest";
import {
  DEFAULT_RULES,
  decideRegistrationStatus,
  parseRegistrationRules,
  serializeRegistrationRules,
  zoneFiscalLabel,
  zoneToRulesKey,
  type RegistrationRules,
  type FieldCheck,
} from "@/lib/registration-rules";

const BASE: RegistrationRules = JSON.parse(JSON.stringify(DEFAULT_RULES));

const nothing: FieldCheck = { provided: false, verifiedValid: null };
const validProvided: FieldCheck = { provided: true, verifiedValid: true };
const invalidProvided: FieldCheck = { provided: true, verifiedValid: false };
const unverifiedProvided: FieldCheck = { provided: true, verifiedValid: null };

describe("parseRegistrationRules", () => {
  it("retombe sur DEFAULT_RULES quand la chaîne est null/vide/invalide", () => {
    expect(parseRegistrationRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRegistrationRules("")).toEqual(DEFAULT_RULES);
    expect(parseRegistrationRules("pas-du-json")).toEqual(DEFAULT_RULES);
  });

  it("accepte un JSON complet pour le nouveau schéma tier FR", () => {
    const rules: RegistrationRules = {
      fr: {
        siret: { requirement: "required", autoVerify: true },
        vat: { requirement: "optional", autoVerify: true },
        kbis: { requirement: "optional" },
        decisions: { all: "approve", siretAndVat: "approve", anyOne: "pending", none: "reject" },
      },
      eu: { vat: { requirement: "required", autoVerify: true, autoVatExempt: true, onValid: "approve", onInvalid: "reject", onMissing: "pending" } },
      world: { brn: { requirement: "optional", autoVerify: false, autoVatExempt: false, onValid: "pending", onInvalid: "pending", onMissing: "pending" } },
    };
    expect(parseRegistrationRules(serializeRegistrationRules(rules))).toEqual(rules);
  });

  it("force autoVerify=false pour world.brn", () => {
    const parsed = parseRegistrationRules(JSON.stringify({
      world: { brn: { ...DEFAULT_RULES.world.brn, autoVerify: true } },
    }));
    expect(parsed.world.brn.autoVerify).toBe(false);
  });

  it("force autoVatExempt=false sur world.brn (pas de VIES hors UE)", () => {
    const parsed = parseRegistrationRules(JSON.stringify({
      world: { brn: { ...DEFAULT_RULES.world.brn, autoVerify: true, autoVatExempt: true } },
    }));
    expect(parsed.world.brn.autoVatExempt).toBe(false);
  });

  it("force autoVatExempt=false si autoVerify est désactivé (sans VIES, pas d'exonération)", () => {
    const parsed = parseRegistrationRules(JSON.stringify({
      eu: { vat: { requirement: "required", autoVerify: false, autoVatExempt: true, onValid: "approve", onInvalid: "pending", onMissing: "pending" } },
    }));
    expect(parsed.eu.vat.autoVatExempt).toBe(false);
  });

  it("conserve autoVatExempt=true si autoVerify=true sur eu.vat", () => {
    const parsed = parseRegistrationRules(JSON.stringify({
      eu: { vat: { requirement: "required", autoVerify: true, autoVatExempt: true, onValid: "approve", onInvalid: "pending", onMissing: "pending" } },
    }));
    expect(parsed.eu.vat.autoVatExempt).toBe(true);
  });

  it("rétrocompat : ancien schéma per-field FR est converti (siret relu)", () => {
    const legacy = JSON.stringify({
      fr: { fiscalNumber: "required", autoVerify: true, onValid: "approve", onInvalid: "reject", onMissing: "pending" },
    });
    const parsed = parseRegistrationRules(legacy);
    expect(parsed.fr.siret.requirement).toBe("required");
    expect(parsed.fr.siret.autoVerify).toBe(true);
    expect(parsed.fr.kbis.requirement).toBe("optional"); // défaut
    expect(parsed.fr.decisions).toEqual(DEFAULT_RULES.fr.decisions);
  });

  it("rétrocompat : ancienne valeur 'none' lue comme 'optional'", () => {
    const parsed = parseRegistrationRules(JSON.stringify({
      fr: { siret: { requirement: "none", autoVerify: false } },
    }));
    expect(parsed.fr.siret.requirement).toBe("optional");
  });
});

describe("zoneToRulesKey / zoneFiscalLabel", () => {
  it("mappe correctement les zones", () => {
    expect(zoneToRulesKey("FR")).toBe("fr");
    expect(zoneToRulesKey("EU")).toBe("eu");
    expect(zoneToRulesKey("WORLD")).toBe("world");
  });

  it("retourne un libellé fiscal lisible", () => {
    expect(zoneFiscalLabel("FR")).toContain("SIRET");
    expect(zoneFiscalLabel("FR")).toContain("KBIS");
    expect(zoneFiscalLabel("EU")).toContain("TVA");
    expect(zoneFiscalLabel("WORLD")).toContain("entreprise");
  });
});

describe("FR tier — matching des niveaux", () => {
  // Rules canoniques : SIRET requis + autoVerify, TVA + KBIS optionnels
  // Décisions explicites par niveau pour tester le matching.
  const RULES: RegistrationRules = {
    ...BASE,
    fr: {
      siret: { requirement: "required", autoVerify: true },
      vat: { requirement: "optional", autoVerify: true },
      kbis: { requirement: "optional" },
      decisions: { all: "approve", siretAndVat: "pending", anyOne: "pending", none: "reject" },
    },
  };

  it("SIRET valide + TVA valide + KBIS joint → `all` → approve", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: validProvided, kbisAttached: true,
    });
    expect(d).toEqual({ kind: "status", status: "APPROVED" });
  });

  it("SIRET valide + TVA valide (KBIS absent) → `siretAndVat` → pending", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: validProvided, kbisAttached: false,
    });
    expect(d).toEqual({ kind: "status", status: "PENDING" });
  });

  it("SIRET valide seul (TVA invalide, KBIS absent) → `anyOne` → pending", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: invalidProvided, kbisAttached: false,
    });
    expect(d).toEqual({ kind: "status", status: "PENDING" });
  });

  it("KBIS seul ne suffit PAS : SIRET + TVA pas valides → tier `none`", () => {
    // Le KBIS n'étant pas vérifiable, il ne compte pas comme critère validé.
    // Même avec KBIS joint, on tombe en `none` si SIRET et TVA ne sont pas valides.
    const permissive = structuredClone(RULES);
    permissive.fr.siret.requirement = "optional";
    const d = decideRegistrationStatus("FR", permissive, {
      siret: nothing, vat: nothing, kbisAttached: true,
    });
    expect(d).toEqual({ kind: "status", status: "REJECTED" });
  });

  it("Rien de valide (tout invalide ou absent, SIRET requis absent) → missing", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: nothing, vat: nothing, kbisAttached: false,
    });
    expect(d.kind).toBe("missingFiscalRejected");
    if (d.kind === "missingFiscalRejected") expect(d.missingFields).toEqual(["SIRET"]);
  });

  it("SIRET fourni + tout invalide → `none` (jamais aucun critère validé)", () => {
    const permissive = structuredClone(RULES);
    permissive.fr.siret.requirement = "optional";
    const d = decideRegistrationStatus("FR", permissive, {
      siret: invalidProvided, vat: invalidProvided, kbisAttached: false,
    });
    expect(d).toEqual({ kind: "status", status: "REJECTED" });
  });

  it("SIRET valide + TVA invalide + KBIS joint → `anyOne` (KBIS n'améliore pas sans SIRET+TVA)", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: invalidProvided, kbisAttached: true,
    });
    // Pas tier `all` car TVA invalide. Pas tier `siretAndVat`. Donc `anyOne`.
    expect(d).toEqual({ kind: "status", status: "PENDING" });
  });
});

describe("FR tier — champs obligatoires manquants", () => {
  it("SIRET et KBIS requis + les deux absents → missing avec les 2 noms", () => {
    const rules = structuredClone(BASE);
    rules.fr.siret.requirement = "required";
    rules.fr.kbis.requirement = "required";
    const d = decideRegistrationStatus("FR", rules, { siret: nothing, vat: nothing, kbisAttached: false });
    expect(d.kind).toBe("missingFiscalRejected");
    if (d.kind === "missingFiscalRejected") {
      expect(d.missingFields).toEqual(["SIRET", "KBIS"]);
    }
  });
});

describe("FR tier — panne service (serviceErrored)", () => {
  const RULES: RegistrationRules = {
    ...BASE,
    fr: {
      siret: { requirement: "required", autoVerify: true },
      vat: { requirement: "optional", autoVerify: true },
      kbis: { requirement: "optional" },
      decisions: { all: "approve", siretAndVat: "approve", anyOne: "pending", none: "reject" },
    },
  };

  it("SIRET service down + TVA valide → `anyOne` (pending), serviceErrored posé", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: unverifiedProvided, vat: validProvided, kbisAttached: false,
    });
    expect(d).toEqual({ kind: "status", status: "PENDING", serviceErrored: true });
  });

  it("SIRET valide + TVA service down → `anyOne` (pending), serviceErrored posé", () => {
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: unverifiedProvided, kbisAttached: false,
    });
    expect(d).toEqual({ kind: "status", status: "PENDING", serviceErrored: true });
  });

  it("SIRET + TVA valides + KBIS joint même avec panne → approve (pas de flag)", () => {
    // Les 3 ok → `all` → approve. Pas de panne car tout a été résolu.
    const d = decideRegistrationStatus("FR", RULES, {
      siret: validProvided, vat: validProvided, kbisAttached: true,
    });
    expect(d).toEqual({ kind: "status", status: "APPROVED" });
  });
});

describe("Zones UE / WORLD — modèle per-field inchangé", () => {
  it("EU : TVA requise absente → missing", () => {
    const d = decideRegistrationStatus("EU", BASE, { vat: nothing });
    expect(d.kind).toBe("missingFiscalRejected");
  });

  it("EU : TVA valide → onValid", () => {
    const rules = structuredClone(BASE);
    rules.eu.vat = { ...rules.eu.vat, autoVerify: true, onValid: "approve" };
    const d = decideRegistrationStatus("EU", rules, { vat: validProvided });
    expect(d).toEqual({ kind: "status", status: "APPROVED" });
  });

  it("EU : TVA service down → PENDING + serviceErrored", () => {
    const rules = structuredClone(BASE);
    rules.eu.vat = { ...rules.eu.vat, autoVerify: true, onValid: "approve", onInvalid: "reject" };
    const d = decideRegistrationStatus("EU", rules, { vat: unverifiedProvided });
    expect(d).toEqual({ kind: "status", status: "PENDING", serviceErrored: true });
  });

  it("WORLD : BRN optional absent → onMissing", () => {
    const rules = structuredClone(BASE);
    rules.world.brn = { ...rules.world.brn, requirement: "optional", onMissing: "approve" };
    const d = decideRegistrationStatus("WORLD", rules, { brn: nothing });
    expect(d).toEqual({ kind: "status", status: "APPROVED" });
  });
});

describe("Défauts historiques", () => {
  it("DEFAULT_RULES met toujours en PENDING (validation manuelle)", () => {
    const dFr = decideRegistrationStatus("FR", BASE, { siret: validProvided, vat: validProvided, kbisAttached: true });
    const dEu = decideRegistrationStatus("EU", BASE, { vat: validProvided });
    const dWorld = decideRegistrationStatus("WORLD", BASE, { brn: validProvided });
    expect(dFr.kind === "status" && dFr.status).toBe("PENDING");
    expect(dEu.kind === "status" && dEu.status).toBe("PENDING");
    expect(dWorld.kind === "status" && dWorld.status).toBe("PENDING");
  });
});
