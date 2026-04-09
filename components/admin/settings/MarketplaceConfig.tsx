"use client";

import { useState, useTransition } from "react";
import {
  updatePfsCredentials,
  validatePfsCredentials,
  togglePfsEnabled,
  updateAnkorstoreCredentials,
  validateAnkorstoreCredentials,
  toggleAnkorstoreEnabled,
  updateMarketplaceMarkup,
} from "@/app/actions/admin/site-config";
import type { MarkupType, RoundingMode } from "@/lib/marketplace-pricing";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface MarkupState {
  type: MarkupType;
  value: number;
  rounding: RoundingMode;
}

interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
  hasAnkorsConfig: boolean;
  ankorsEnabled: boolean;
  markupSettings: {
    pfs: MarkupState;
    ankorstoreWholesale: MarkupState;
    ankorstoreRetail: MarkupState;
  };
}

function MarkupRow({
  label,
  state,
  onChange,
}: {
  label: string;
  state: MarkupState;
  onChange: (s: MarkupState) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="font-body text-xs font-medium text-text-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={state.value}
          onChange={(e) => onChange({ ...state, value: Number(e.target.value) || 0 })}
          className="w-24 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
        />
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => onChange({ ...state, type: "percent" })}
            className={`h-9 px-3 text-sm font-body font-medium transition-colors ${
              state.type === "percent"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >
            %
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...state, type: "fixed" })}
            className={`h-9 px-3 text-sm font-body font-medium transition-colors ${
              state.type === "fixed"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
            }`}
          >
            &euro;
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-body text-xs text-text-secondary">Arrondi :</span>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            ["none", "Aucun"],
            ["down", "Inférieur"],
            ["up", "Supérieur"],
          ] as const).map(([mode, lbl]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...state, rounding: mode })}
              className={`h-8 px-3 text-xs font-body font-medium transition-colors ${
                state.rounding === mode
                  ? "bg-bg-dark text-text-inverse"
                  : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MarketplaceConfig({
  hasPfsConfig,
  pfsEnabled: initialPfsEnabled,
  hasAnkorsConfig,
  ankorsEnabled: initialAnkorsEnabled,
  markupSettings,
}: Props) {
  // PFS state
  const [pfsEmail, setPfsEmail] = useState("");
  const [pfsPassword, setPfsPassword] = useState("");
  const [pfsStatus, setPfsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasPfsConfig ? "valid" : "none"
  );
  const [pfsEnabled, setPfsEnabled] = useState(initialPfsEnabled);
  const [pfsEditing, setPfsEditing] = useState(!hasPfsConfig);
  const [isSavingPfs, startSavingPfs] = useTransition();
  const [isValidatingPfs, startValidatingPfs] = useTransition();
  const [isTogglingPfs, startTogglingPfs] = useTransition();

  // Ankorstore state
  const [ankorsClientId, setAnkorsClientId] = useState("");
  const [ankorsClientSecret, setAnkorsClientSecret] = useState("");
  const [ankorsStatus, setAnkorsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasAnkorsConfig ? "valid" : "none"
  );
  const [ankorsEnabledState, setAnkorsEnabledState] = useState(initialAnkorsEnabled);
  const [ankorsEditing, setAnkorsEditing] = useState(!hasAnkorsConfig);
  const [isSavingAnkors, startSavingAnkors] = useTransition();
  const [isValidatingAnkors, startValidatingAnkors] = useTransition();
  const [isTogglingAnkors, startTogglingAnkors] = useTransition();

  // Markup state
  const [pfsMarkup, setPfsMarkup] = useState<MarkupState>(markupSettings.pfs);
  const [ankorsWholesaleMarkup, setAnkorsWholesaleMarkup] = useState<MarkupState>(markupSettings.ankorstoreWholesale);
  const [ankorsRetailMarkup, setAnkorsRetailMarkup] = useState<MarkupState>(markupSettings.ankorstoreRetail);
  const [isSavingMarkup, startSavingMarkup] = useTransition();

  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const isPendingPfs = isSavingPfs || isValidatingPfs || isTogglingPfs;
  const isPendingAnkors = isSavingAnkors || isValidatingAnkors || isTogglingAnkors;

  function handlePfsValidate() {
    if (!pfsEmail.trim() || !pfsPassword.trim()) return;
    showLoading();
    startValidatingPfs(async () => {
      try {
        setPfsStatus("checking");
        const result = await validatePfsCredentials({
          email: pfsEmail.trim(),
          password: pfsPassword.trim(),
        });
        if (result.valid) {
          setPfsStatus("valid");
          toast.success("Connexion réussie", "Identifiants Paris Fashion Shops valides.");
        } else {
          setPfsStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handlePfsSave() {
    showLoading();
    startSavingPfs(async () => {
      try {
        const result = await updatePfsCredentials({
          email: pfsEmail.trim(),
          password: pfsPassword.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants PFS sauvegardés.");
          setPfsEditing(false);
          setPfsEmail("");
          setPfsPassword("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handlePfsToggle() {
    const newValue = !pfsEnabled;
    startTogglingPfs(async () => {
      const result = await togglePfsEnabled(newValue);
      if (result.success) {
        setPfsEnabled(newValue);
        toast.success(
          newValue ? "PFS activé" : "PFS désactivé",
          newValue
            ? "La synchronisation Paris Fashion Shops est maintenant active."
            : "Les fonctionnalités Paris Fashion Shops sont désactivées."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  // ─── Ankorstore handlers ──────────────────────────────────────────────────

  function handleAnkorsValidate() {
    if (!ankorsClientId.trim() || !ankorsClientSecret.trim()) return;
    showLoading();
    startValidatingAnkors(async () => {
      try {
        setAnkorsStatus("checking");
        const result = await validateAnkorstoreCredentials({
          clientId: ankorsClientId.trim(),
          clientSecret: ankorsClientSecret.trim(),
        });
        if (result.valid) {
          setAnkorsStatus("valid");
          toast.success("Connexion réussie", "Identifiants Ankorstore valides.");
        } else {
          setAnkorsStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAnkorsSave() {
    showLoading();
    startSavingAnkors(async () => {
      try {
        const result = await updateAnkorstoreCredentials({
          clientId: ankorsClientId.trim(),
          clientSecret: ankorsClientSecret.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants Ankorstore sauvegardés.");
          setAnkorsEditing(false);
          setAnkorsClientId("");
          setAnkorsClientSecret("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAnkorsToggle() {
    const newValue = !ankorsEnabledState;
    startTogglingAnkors(async () => {
      const result = await toggleAnkorstoreEnabled(newValue);
      if (result.success) {
        setAnkorsEnabledState(newValue);
        toast.success(
          newValue ? "Ankorstore activé" : "Ankorstore désactivé",
          newValue
            ? "L'intégration Ankorstore est maintenant active."
            : "L'intégration Ankorstore est désactivée."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  function handleSaveMarkup() {
    showLoading();
    startSavingMarkup(async () => {
      try {
        const result = await updateMarketplaceMarkup({
          pfs: pfsMarkup,
          ankorstoreWholesale: ankorsWholesaleMarkup,
          ankorstoreRetail: ankorsRetailMarkup,
        });
        if (result.success) {
          toast.success("Enregistré", "Majorations marketplace sauvegardées.");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-semibold text-text-primary">Paris Fashion Shops</h4>
            <span
              className={`w-2 h-2 rounded-full ${
                pfsStatus === "valid" ? "bg-[#22C55E]" :
                pfsStatus === "invalid" ? "bg-[#EF4444]" :
                pfsStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {pfsStatus === "valid" && "Connecté"}
              {pfsStatus === "invalid" && "Invalide"}
              {pfsStatus === "checking" && "Vérification..."}
              {pfsStatus === "none" && "Non configuré"}
            </span>
          </div>

          {hasPfsConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={pfsEnabled}
              aria-label="Activer Paris Fashion Shops"
              disabled={isPendingPfs}
              onClick={handlePfsToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                pfsEnabled ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  pfsEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {!pfsEditing && hasPfsConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setPfsEditing(true)}
              className="text-sm font-body text-text-secondary hover:text-text-primary underline"
            >
              Modifier
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <input
                type="email"
                value={pfsEmail}
                onChange={(e) => {
                  setPfsEmail(e.target.value);
                  if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                }}
                placeholder="Email PFS"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingPfs}
                autoComplete="off"
              />
              <input
                type="password"
                value={pfsPassword}
                onChange={(e) => {
                  setPfsPassword(e.target.value);
                  if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                }}
                placeholder="Mot de passe PFS"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingPfs}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePfsValidate}
                disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingPfs ? "Vérification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handlePfsSave}
                disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim() || pfsStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingPfs ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasPfsConfig && (
                <button
                  type="button"
                  onClick={() => { setPfsEditing(false); setPfsEmail(""); setPfsPassword(""); setPfsStatus("valid"); }}
                  disabled={isPendingPfs}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Ankorstore ───────────────────────────────────────────────────── */}
      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-semibold text-text-primary">Ankorstore</h4>
            <span
              className={`w-2 h-2 rounded-full ${
                ankorsStatus === "valid" ? "bg-[#22C55E]" :
                ankorsStatus === "invalid" ? "bg-[#EF4444]" :
                ankorsStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {ankorsStatus === "valid" && "Connecté"}
              {ankorsStatus === "invalid" && "Invalide"}
              {ankorsStatus === "checking" && "Vérification..."}
              {ankorsStatus === "none" && "Non configuré"}
            </span>
          </div>

          {hasAnkorsConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={ankorsEnabledState}
              aria-label="Activer Ankorstore"
              disabled={isPendingAnkors}
              onClick={handleAnkorsToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                ankorsEnabledState ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  ankorsEnabledState ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {!ankorsEditing && hasAnkorsConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setAnkorsEditing(true)}
              className="text-sm font-body text-text-secondary hover:text-text-primary underline"
            >
              Modifier
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <input
                type="text"
                value={ankorsClientId}
                onChange={(e) => {
                  setAnkorsClientId(e.target.value);
                  if (ankorsStatus === "valid" || ankorsStatus === "invalid") setAnkorsStatus("none");
                }}
                placeholder="Client ID"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAnkors}
                autoComplete="off"
              />
              <input
                type="password"
                value={ankorsClientSecret}
                onChange={(e) => {
                  setAnkorsClientSecret(e.target.value);
                  if (ankorsStatus === "valid" || ankorsStatus === "invalid") setAnkorsStatus("none");
                }}
                placeholder="Client Secret"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAnkors}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAnkorsValidate}
                disabled={isPendingAnkors || !ankorsClientId.trim() || !ankorsClientSecret.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingAnkors ? "Vérification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handleAnkorsSave}
                disabled={isPendingAnkors || !ankorsClientId.trim() || !ankorsClientSecret.trim() || ankorsStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingAnkors ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasAnkorsConfig && (
                <button
                  type="button"
                  onClick={() => { setAnkorsEditing(false); setAnkorsClientId(""); setAnkorsClientSecret(""); setAnkorsStatus("valid"); }}
                  disabled={isPendingAnkors}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Majorations prix ───────────────────────────────────────── */}
      <div className="border-t border-border pt-4 space-y-4">
        <div>
          <h4 className="font-heading text-sm font-semibold text-text-primary mb-1">Majorations prix</h4>
          <p className="text-xs text-text-secondary font-body mb-3">
            Ajoutez un supplément aux prix envoyés aux marketplaces. Par défaut : 0 (pas de majoration).
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <h5 className="font-body text-xs font-semibold text-text-primary uppercase tracking-wider">Paris Fashion Shops</h5>
            <MarkupRow label="Prix HT" state={pfsMarkup} onChange={setPfsMarkup} />
          </div>

          <div className="border-t border-border pt-3 space-y-3">
            <h5 className="font-body text-xs font-semibold text-text-primary uppercase tracking-wider">Ankorstore</h5>
            <MarkupRow label="Prix wholesale (gros)" state={ankorsWholesaleMarkup} onChange={setAnkorsWholesaleMarkup} />
            <MarkupRow label="Prix retail (détail)" state={ankorsRetailMarkup} onChange={setAnkorsRetailMarkup} />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSaveMarkup}
          disabled={isSavingMarkup}
          className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
        >
          {isSavingMarkup ? "Enregistrement..." : "Sauvegarder les majorations"}
        </button>
      </div>
    </div>
  );
}
