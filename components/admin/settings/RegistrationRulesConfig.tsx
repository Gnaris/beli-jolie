"use client";

import { useState, useTransition } from "react";
import CustomSelect from "@/components/ui/CustomSelect";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { updateRegistrationRules } from "@/app/actions/admin/registration-rules";
import type {
  RegistrationRules,
  FieldRule,
  FrFieldWithVerify,
  FrFieldDocument,
  FrTierDecisions,
  FiscalRequirement,
  RegistrationDecision,
} from "@/lib/registration-rules";

interface Props {
  initialRules: RegistrationRules;
}

const FISCAL_OPTIONS = [
  { value: "required", label: "Obligatoire" },
  { value: "optional", label: "Optionnel" },
];
const DECISION_OPTIONS = [
  { value: "approve", label: "Approuver automatiquement" },
  { value: "pending", label: "Laisser en attente" },
  { value: "reject", label: "Refuser automatiquement" },
];

export default function RegistrationRulesConfig({ initialRules }: Props) {
  const [rules, setRules] = useState<RegistrationRules>(initialRules);
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = JSON.stringify(rules) !== JSON.stringify(initialRules);

  function patch(mutator: (draft: RegistrationRules) => void) {
    setRules((prev) => {
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
    setMsg(null);
  }

  function handleSave() {
    setMsg(null);
    showLoading();
    startTransition(async () => {
      try {
        const res = await updateRegistrationRules(rules);
        setMsg(res.success ? { ok: true, text: "Enregistré" } : { ok: false, text: res.error ?? "Erreur" });
        if (res.success) setTimeout(() => setMsg(null), 3000);
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900 font-body">
        <strong>Comment ça marche :</strong> à chaque inscription, le site vérifie les numéros/documents fournis
        puis applique la décision correspondant au niveau atteint. Laissez tout en « En attente » pour revenir
        au comportement actuel (validation manuelle de chaque dossier).
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <FranceCard
          rule={rules.fr}
          onPatch={(mutator) => patch((draft) => mutator(draft.fr))}
        />
        <SingleFieldCard
          title="UE hors France"
          subtitle="26 pays de l'Union européenne"
          field={{
            label: "Numéro de TVA intracommunautaire",
            shortLabel: "TVA",
            verifierLabel: "Vérifier auto via VIES",
            verifierNote: "Service officiel de la Commission européenne · peut mettre jusqu'à 30 s",
            canAutoVerify: true,
            canAutoVatExempt: true,
          }}
          rule={rules.eu.vat}
          onPatch={(mutator) => patch((draft) => mutator(draft.eu.vat))}
        />
        <SingleFieldCard
          title="International"
          subtitle="Reste du monde"
          field={{
            label: "Numéro d'entreprise",
            shortLabel: "N° entreprise",
            verifierLabel: "Vérification automatique indisponible",
            verifierNote: "Pas de registre mondial unifié : vérification manuelle",
            canAutoVerify: false,
          }}
          rule={rules.world.brn}
          onPatch={(mutator) => patch((draft) => mutator(draft.world.brn))}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !dirty}
          className="btn-primary text-sm disabled:opacity-40"
        >
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
        {msg && (
          <span className={`text-xs font-body ${msg.ok ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Carte France : SIRET + TVA + KBIS + 4 décisions tier ─────────── */

function FranceCard({
  rule,
  onPatch,
}: {
  rule: RegistrationRules["fr"];
  onPatch: (mutator: (fr: RegistrationRules["fr"]) => void) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden flex flex-col lg:col-span-1">
      <div className="px-4 py-3 border-b border-border bg-bg-secondary/40">
        <h4 className="font-heading text-[15px] font-bold text-text-primary">France</h4>
        <p className="text-[12px] text-text-muted font-body mt-0.5">Métropole + DOM-TOM — modèle à niveaux</p>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {/* Section Champs */}
        <section className="space-y-4">
          <h5 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-text-muted font-body">
            Champs demandés
          </h5>

          <FieldVerifyBlock
            label="SIRET"
            verifierLabel="Vérifier auto via l'annuaire des entreprises"
            verifierNote="Service INSEE (recherche-entreprises.api.gouv.fr) · gratuit, sans clé"
            rule={rule.siret}
            onPatch={(mutator) => onPatch((fr) => mutator(fr.siret))}
          />

          <FieldVerifyBlock
            label="Numéro de TVA intracommunautaire"
            verifierLabel="Vérifier auto via VIES"
            verifierNote="Service officiel de la Commission européenne · peut mettre jusqu'à 30 s"
            rule={rule.vat}
            onPatch={(mutator) => onPatch((fr) => mutator(fr.vat))}
          />

          <FieldDocumentBlock
            label="KBIS (pièce jointe)"
            note="Fichier PDF/image envoyé par la cliente — pas de vérification automatique possible"
            rule={rule.kbis}
            onPatch={(mutator) => onPatch((fr) => mutator(fr.kbis))}
          />
        </section>

        {/* Section Décisions à niveaux */}
        <section className="pt-3 border-t border-dashed border-border space-y-3">
          <div>
            <h5 className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-text-muted font-body">
              Décisions automatiques
            </h5>
            <p className="text-[11px] text-text-muted font-body mt-1 leading-snug">
              Le site évalue le dossier du haut vers le bas et applique le premier cas qui correspond.
            </p>
          </div>

          <TierRow
            label="Si SIRET valide + TVA valide + KBIS joint"
            value={rule.decisions.all}
            onChange={(v) => onPatch((fr) => { fr.decisions.all = v; })}
          />
          <TierRow
            label="Si SIRET valide + TVA valide (KBIS absent)"
            value={rule.decisions.siretAndVat}
            onChange={(v) => onPatch((fr) => { fr.decisions.siretAndVat = v; })}
          />
          <TierRow
            label="Si au moins un critère validé (SIRET valide ou TVA valide)"
            value={rule.decisions.anyOne}
            onChange={(v) => onPatch((fr) => { fr.decisions.anyOne = v; })}
          />
          <TierRow
            label="Si aucun critère validé (ni SIRET, ni TVA)"
            value={rule.decisions.none}
            onChange={(v) => onPatch((fr) => { fr.decisions.none = v; })}
          />
          <p className="text-[11px] text-text-muted font-body italic leading-snug pt-1">
            Le KBIS ne compte pas comme critère validé seul (impossible de prouver l'authenticité
            du document). Il n'est utile qu'en bonus pour le niveau « les 3 ensemble ».
          </p>
        </section>
      </div>
    </div>
  );
}

function FieldVerifyBlock({
  label,
  verifierLabel,
  verifierNote,
  rule,
  onPatch,
}: {
  label: string;
  verifierLabel: string;
  verifierNote: string;
  rule: FrFieldWithVerify;
  onPatch: (mutator: (r: FrFieldWithVerify) => void) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/30 p-3 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h6 className="font-heading text-[13px] font-bold text-text-primary">{label}</h6>
      </div>
      <CustomSelect
        value={rule.requirement}
        onChange={(v) => onPatch((r) => { r.requirement = v as FiscalRequirement; })}
        options={FISCAL_OPTIONS}
        size="sm"
      />
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={rule.autoVerify}
            onChange={(e) => onPatch((r) => { r.autoVerify = e.target.checked; })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-[#D1D5DB] rounded-full peer-checked:bg-bg-dark transition-colors" />
          <div className="absolute top-[2px] left-[2px] w-4 h-4 bg-bg-primary rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
        </div>
        <div className="flex-1">
          <p className="text-[12.5px] font-medium text-text-primary font-body">{verifierLabel}</p>
          <p className="text-[11px] text-text-muted font-body mt-0.5">{verifierNote}</p>
        </div>
      </label>
    </div>
  );
}

function FieldDocumentBlock({
  label,
  note,
  rule,
  onPatch,
}: {
  label: string;
  note: string;
  rule: FrFieldDocument;
  onPatch: (mutator: (r: FrFieldDocument) => void) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/30 p-3 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h6 className="font-heading text-[13px] font-bold text-text-primary">{label}</h6>
      </div>
      <CustomSelect
        value={rule.requirement}
        onChange={(v) => onPatch((r) => { r.requirement = v as FiscalRequirement; })}
        options={FISCAL_OPTIONS}
        size="sm"
      />
      <p className="text-[11px] text-text-muted font-body leading-snug">{note}</p>
    </div>
  );
}

function TierRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RegistrationDecision;
  onChange: (v: RegistrationDecision) => void;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-text-secondary font-body mb-1 leading-tight">
        {label}
      </label>
      <CustomSelect
        value={value}
        onChange={(v) => onChange(v as RegistrationDecision)}
        options={DECISION_OPTIONS}
        size="sm"
      />
    </div>
  );
}

/* ─── Carte UE / WORLD : 1 champ, modèle per-field ─────────────────── */

interface SingleFieldMeta {
  label: string;
  shortLabel: string;
  verifierLabel: string;
  verifierNote: string;
  canAutoVerify: boolean;
  canAutoVatExempt?: boolean;
}

function SingleFieldCard({
  title,
  subtitle,
  field,
  rule,
  onPatch,
}: {
  title: string;
  subtitle: string;
  field: SingleFieldMeta;
  rule: FieldRule;
  onPatch: (mutator: (r: FieldRule) => void) => void;
}) {
  const effectiveAutoVerify = field.canAutoVerify && rule.autoVerify;
  const showOnInvalid = effectiveAutoVerify;
  const showOnMissing = rule.requirement === "optional";

  const onValidLabel = effectiveAutoVerify
    ? `Si ${field.shortLabel} valide`
    : `Si ${field.shortLabel} renseigné`;

  return (
    <div className="rounded-2xl border border-border bg-bg-primary shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-border bg-bg-secondary/40">
        <h4 className="font-heading text-[15px] font-bold text-text-primary">{title}</h4>
        <p className="text-[12px] text-text-muted font-body mt-0.5">{subtitle}</p>
      </div>

      <div className="p-4 space-y-4 flex-1">
        <div>
          <label className="block text-[12px] font-semibold text-text-primary font-body mb-1.5">
            {field.label}
          </label>
          <CustomSelect
            value={rule.requirement}
            onChange={(v) => onPatch((r) => { r.requirement = v as FiscalRequirement; })}
            options={FISCAL_OPTIONS}
            size="sm"
          />
        </div>

        <div className={`rounded-xl border px-3 py-2.5 ${
          field.canAutoVerify ? "border-border bg-bg-secondary/30" : "border-dashed border-border-strong bg-bg-secondary/20 opacity-70"
        }`}>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <div className="relative mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={effectiveAutoVerify}
                onChange={(e) => onPatch((r) => {
                  r.autoVerify = e.target.checked;
                  // Désactiver la vérif coupe aussi l'exonération auto :
                  // sans VIES, on ne peut pas prouver la validité.
                  if (!e.target.checked) r.autoVatExempt = false;
                })}
                disabled={!field.canAutoVerify}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#D1D5DB] rounded-full peer-checked:bg-bg-dark peer-disabled:bg-[#E5E7EB] transition-colors" />
              <div className="absolute top-[2px] left-[2px] w-4 h-4 bg-bg-primary rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <div className="flex-1">
              <p className="text-[12.5px] font-medium text-text-primary font-body">{field.verifierLabel}</p>
              <p className="text-[11px] text-text-muted font-body mt-0.5">{field.verifierNote}</p>
            </div>
          </label>
        </div>

        {field.canAutoVatExempt && effectiveAutoVerify && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={rule.autoVatExempt}
                  onChange={(e) => onPatch((r) => { r.autoVatExempt = e.target.checked; })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#D1D5DB] rounded-full peer-checked:bg-emerald-600 transition-colors" />
                <div className="absolute top-[2px] left-[2px] w-4 h-4 bg-bg-primary rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
              </div>
              <div className="flex-1">
                <p className="text-[12.5px] font-medium text-emerald-900 font-body">
                  Exonérer de TVA automatiquement si VIES confirme le numéro
                </p>
                <p className="text-[11px] text-emerald-800/80 font-body mt-0.5">
                  Le client UE hors France paiera 0 % de TVA dès son inscription (équivalent du bouton d'exonération manuel sur sa fiche).
                </p>
              </div>
            </label>
          </div>
        )}

        <div className="space-y-2">
          <TierRow
            label={onValidLabel}
            value={rule.onValid}
            onChange={(v) => onPatch((r) => { r.onValid = v; })}
          />
          {showOnInvalid && (
            <TierRow
              label={`Si ${field.shortLabel} invalide ou introuvable`}
              value={rule.onInvalid}
              onChange={(v) => onPatch((r) => { r.onInvalid = v; })}
            />
          )}
          {showOnMissing && (
            <TierRow
              label={`Si pas de ${field.shortLabel} renseigné`}
              value={rule.onMissing}
              onChange={(v) => onPatch((r) => { r.onMissing = v; })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
