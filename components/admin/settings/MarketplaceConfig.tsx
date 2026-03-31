"use client";

import { useState, useTransition } from "react";
import {
  updatePfsCredentials,
  validatePfsCredentials,
  togglePfsEnabled,
  updateEfashionCredentials,
  validateEfashionCredentials,
  toggleEfashionEnabled,
} from "@/app/actions/admin/site-config";
import {
  validateAnkorstoreCredentials,
  updateAnkorstoreCredentials,
  toggleAnkorstoreEnabled,
} from "@/app/actions/admin/ankorstore-sync";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
}

export default function MarketplaceConfig({
  hasPfsConfig,
  pfsEnabled: initialPfsEnabled,
  hasEfashionConfig,
  efashionEnabled: initialEfashionEnabled,
  hasAnkorstoreConfig,
  ankorstoreEnabled: initialAnkorstoreEnabled,
}: Props) {
  // ── PFS state ──────────────────────────────────────────────────────────────
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

  // ── eFashion state ─────────────────────────────────────────────────────────
  const [efashionEmail, setEfashionEmail] = useState("");
  const [efashionPassword, setEfashionPassword] = useState("");
  const [efashionStatus, setEfashionStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasEfashionConfig ? "valid" : "none"
  );
  const [efashionEnabled, setEfashionEnabled] = useState(initialEfashionEnabled);
  const [efashionEditing, setEfashionEditing] = useState(!hasEfashionConfig);
  const [efashionVendorId, setEfashionVendorId] = useState<number | undefined>();
  const [efashionBoutique, setEfashionBoutique] = useState<string | undefined>();
  const [isSavingEfashion, startSavingEfashion] = useTransition();
  const [isValidatingEfashion, startValidatingEfashion] = useTransition();
  const [isTogglingEfashion, startTogglingEfashion] = useTransition();

  // ── Ankorstore state ──────────────────────────────────────────────────────
  const [akClientId, setAkClientId] = useState("");
  const [akClientSecret, setAkClientSecret] = useState("");
  const [akStatus, setAkStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasAnkorstoreConfig ? "valid" : "none"
  );
  const [akEnabled, setAkEnabled] = useState(initialAnkorstoreEnabled);
  const [akEditing, setAkEditing] = useState(!hasAnkorstoreConfig);
  const [isSavingAk, startSavingAk] = useTransition();
  const [isValidatingAk, startValidatingAk] = useTransition();
  const [isTogglingAk, startTogglingAk] = useTransition();

  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const isPendingPfs = isSavingPfs || isValidatingPfs || isTogglingPfs;
  const isPendingEfashion = isSavingEfashion || isValidatingEfashion || isTogglingEfashion;
  const isPendingAk = isSavingAk || isValidatingAk || isTogglingAk;

  // ── PFS handlers ───────────────────────────────────────────────────────────

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

  // ── eFashion handlers ──────────────────────────────────────────────────────

  function handleEfashionValidate() {
    if (!efashionEmail.trim() || !efashionPassword.trim()) return;
    showLoading();
    startValidatingEfashion(async () => {
      try {
        setEfashionStatus("checking");
        setEfashionVendorId(undefined);
        setEfashionBoutique(undefined);
        const result = await validateEfashionCredentials({
          email: efashionEmail.trim(),
          password: efashionPassword.trim(),
        });
        if (result.valid) {
          setEfashionStatus("valid");
          setEfashionVendorId(result.vendorId);
          setEfashionBoutique(result.boutique);
          toast.success("Connexion réussie", `eFashion Paris — ${result.boutique ?? "boutique connectée"}`);
        } else {
          setEfashionStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleEfashionSave() {
    showLoading();
    startSavingEfashion(async () => {
      try {
        const result = await updateEfashionCredentials({
          email: efashionEmail.trim(),
          password: efashionPassword.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants eFashion Paris sauvegardés.");
          setEfashionEditing(false);
          setEfashionEmail("");
          setEfashionPassword("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleEfashionToggle() {
    const newValue = !efashionEnabled;
    startTogglingEfashion(async () => {
      const result = await toggleEfashionEnabled(newValue);
      if (result.success) {
        setEfashionEnabled(newValue);
        toast.success(
          newValue ? "eFashion activé" : "eFashion désactivé",
          newValue
            ? "La synchronisation eFashion Paris est maintenant active."
            : "Les fonctionnalités eFashion Paris sont désactivées."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  // ── Ankorstore handlers ────────────────────────────────────────────────────

  function handleAkValidate() {
    if (!akClientId.trim() || !akClientSecret.trim()) return;
    showLoading();
    startValidatingAk(async () => {
      try {
        setAkStatus("checking");
        const result = await validateAnkorstoreCredentials({
          clientId: akClientId.trim(),
          clientSecret: akClientSecret.trim(),
        });
        if (result.valid) {
          setAkStatus("valid");
          toast.success("Connexion réussie", "Identifiants Ankorstore valides.");
        } else {
          setAkStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAkSave() {
    showLoading();
    startSavingAk(async () => {
      try {
        const result = await updateAnkorstoreCredentials({
          clientId: akClientId.trim(),
          clientSecret: akClientSecret.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants Ankorstore sauvegardés.");
          setAkEditing(false);
          setAkClientId("");
          setAkClientSecret("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAkToggle() {
    const newValue = !akEnabled;
    startTogglingAk(async () => {
      const result = await toggleAnkorstoreEnabled(newValue);
      if (result.success) {
        setAkEnabled(newValue);
        toast.success(
          newValue ? "Ankorstore activé" : "Ankorstore désactivé",
          newValue
            ? "La synchronisation Ankorstore est maintenant active."
            : "Les fonctionnalités Ankorstore sont désactivées."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* PFS Section */}
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

          {/* Toggle ON/OFF — only show when credentials are configured */}
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

      {/* Divider */}
      <div className="border-t border-border" />

      {/* eFashion Paris Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h4 className="font-heading text-sm font-semibold text-text-primary">eFashion Paris</h4>
              <a
                href="https://wapi.efashion-paris.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-body text-xs text-text-secondary hover:text-text-primary underline"
              >
                wapi.efashion-paris.com
              </a>
            </div>
            <span
              className={`w-2 h-2 rounded-full ${
                efashionStatus === "valid" ? "bg-[#22C55E]" :
                efashionStatus === "invalid" ? "bg-[#EF4444]" :
                efashionStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {efashionStatus === "valid" && "Connecté"}
              {efashionStatus === "invalid" && "Invalide"}
              {efashionStatus === "checking" && "Vérification..."}
              {efashionStatus === "none" && "Non configuré"}
            </span>
          </div>

          {/* Toggle ON/OFF — only show when credentials are configured */}
          {hasEfashionConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={efashionEnabled}
              aria-label="Activer eFashion Paris"
              disabled={isPendingEfashion}
              onClick={handleEfashionToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                efashionEnabled ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  efashionEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {/* Validation result info */}
        {efashionStatus === "valid" && efashionVendorId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/20">
            <span className="font-body text-xs text-[#16A34A]">
              Vendeur #{efashionVendorId}{efashionBoutique ? ` — ${efashionBoutique}` : ""}
            </span>
          </div>
        )}

        {!efashionEditing && hasEfashionConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setEfashionEditing(true)}
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
                value={efashionEmail}
                onChange={(e) => {
                  setEfashionEmail(e.target.value);
                  if (efashionStatus === "valid" || efashionStatus === "invalid") setEfashionStatus("none");
                }}
                placeholder="Email eFashion Paris"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingEfashion}
                autoComplete="off"
              />
              <input
                type="password"
                value={efashionPassword}
                onChange={(e) => {
                  setEfashionPassword(e.target.value);
                  if (efashionStatus === "valid" || efashionStatus === "invalid") setEfashionStatus("none");
                }}
                placeholder="Mot de passe eFashion Paris"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingEfashion}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEfashionValidate}
                disabled={isPendingEfashion || !efashionEmail.trim() || !efashionPassword.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingEfashion ? "Vérification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handleEfashionSave}
                disabled={isPendingEfashion || !efashionEmail.trim() || !efashionPassword.trim() || efashionStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingEfashion ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasEfashionConfig && (
                <button
                  type="button"
                  onClick={() => { setEfashionEditing(false); setEfashionEmail(""); setEfashionPassword(""); setEfashionStatus("valid"); }}
                  disabled={isPendingEfashion}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Ankorstore Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h4 className="font-heading text-sm font-semibold text-text-primary">Ankorstore</h4>
              <a
                href="https://www.ankorstore.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-body text-xs text-text-secondary hover:text-text-primary underline"
              >
                ankorstore.com
              </a>
            </div>
            <span
              className={`w-2 h-2 rounded-full ${
                akStatus === "valid" ? "bg-[#22C55E]" :
                akStatus === "invalid" ? "bg-[#EF4444]" :
                akStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {akStatus === "valid" && "Connecté"}
              {akStatus === "invalid" && "Invalide"}
              {akStatus === "checking" && "Vérification..."}
              {akStatus === "none" && "Non configuré"}
            </span>
          </div>

          {/* Toggle ON/OFF — only show when credentials are configured */}
          {hasAnkorstoreConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={akEnabled}
              aria-label="Activer Ankorstore"
              disabled={isPendingAk}
              onClick={handleAkToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                akEnabled ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  akEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {!akEditing && hasAnkorstoreConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setAkEditing(true)}
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
                value={akClientId}
                onChange={(e) => {
                  setAkClientId(e.target.value);
                  if (akStatus === "valid" || akStatus === "invalid") setAkStatus("none");
                }}
                placeholder="Client ID"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAk}
                autoComplete="off"
              />
              <input
                type="password"
                value={akClientSecret}
                onChange={(e) => {
                  setAkClientSecret(e.target.value);
                  if (akStatus === "valid" || akStatus === "invalid") setAkStatus("none");
                }}
                placeholder="Client Secret"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingAk}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAkValidate}
                disabled={isPendingAk || !akClientId.trim() || !akClientSecret.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingAk ? "Vérification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handleAkSave}
                disabled={isPendingAk || !akClientId.trim() || !akClientSecret.trim() || akStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingAk ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasAnkorstoreConfig && (
                <button
                  type="button"
                  onClick={() => { setAkEditing(false); setAkClientId(""); setAkClientSecret(""); setAkStatus("valid"); }}
                  disabled={isPendingAk}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
