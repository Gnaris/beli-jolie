"use client";

import { useState, useTransition } from "react";
import {
  updatePfsCredentials, validatePfsCredentials,
  updateAnkorstoreCredentials, validateAnkorstoreCredentials, toggleAnkorstoreEnabled,
  updateMarketplaceMarkup,
  loadPfsBrands, updatePfsBrand,
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
  pfsBrand: { id: string; name: string } | null;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  markupSettings: {
    pfs: MarkupState;
    ankorstoreWholesale: MarkupState;
    ankorstoreRetail: MarkupState;
    ankorstoreVatRate: number;
  };
}

// ─── SVG Icons ──────────────────────────────────────────────────────────────
function IconShop({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v12a1 1 0 01-1 1H4a1 1 0 01-1-1V9z" />
      <path d="M9 21V13h6v8" />
      <path d="M3 9c0 1.1.9 2 2 2s2-.9 2-2" />
      <path d="M7 9c0 1.1.9 2 2 2s2-.9 2-2" />
      <path d="M11 9c0 1.1.9 2 2 2s2-.9 2-2" />
      <path d="M15 9c0 1.1.9 2 2 2s2-.9 2-2" />
    </svg>
  );
}

function IconKey({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function IconTag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function StatusBadge({ status }: { status: "none" | "valid" | "invalid" | "checking" }) {
  if (status === "valid") {
    return (
      <span className="badge badge-success">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        Connecté
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="badge badge-error">
        <span className="w-1.5 h-1.5 rounded-full bg-error" />
        Invalide
      </span>
    );
  }
  if (status === "checking") {
    return (
      <span className="badge badge-warning">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
        Vérification…
      </span>
    );
  }
  return (
    <span className="badge badge-neutral">
      <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
      Non configuré
    </span>
  );
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
  const typeOptions: { value: MarkupType; label: string; title: string }[] = [
    { value: "percent", label: "Pourcentage", title: "Ajouter un pourcentage au prix" },
    { value: "fixed", label: "Fixe (€)", title: "Ajouter un montant fixe en euros" },
    { value: "multiplier", label: "Coeff. (×)", title: "Multiplier le prix (ex: 3 = ×3)" },
  ];

  const roundingOptions: { value: RoundingMode; label: string; title: string }[] = [
    { value: "none", label: "Aucun", title: "Pas d'arrondi" },
    { value: "down", label: "Inférieur", title: "Arrondi vers le bas" },
    { value: "up", label: "Supérieur", title: "Arrondi vers le haut" },
  ];

  return (
    <div className="space-y-3">
      <p className="font-body text-sm font-medium text-text-primary">{label}</p>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-shrink-0">
          <label className="font-body text-[11px] text-text-muted mb-1 block">Valeur</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={state.value}
            onChange={(e) => onChange({ ...state, value: Number(e.target.value) || 0 })}
            className="w-full sm:w-24 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
          />
        </div>

        <div className="flex-1 min-w-0">
          <label className="font-body text-[11px] text-text-muted mb-1 block">Type</label>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.title}
                onClick={() => onChange({ ...state, type: opt.value })}
                className={`flex-1 h-9 px-2 text-xs font-body font-medium transition-colors whitespace-nowrap ${
                  state.type === opt.value
                    ? "bg-bg-dark text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <label className="font-body text-[11px] text-text-muted mb-1 block">Arrondi</label>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {roundingOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                title={opt.title}
                onClick={() => onChange({ ...state, rounding: opt.value })}
                className={`flex-1 h-9 px-2 text-xs font-body font-medium transition-colors whitespace-nowrap ${
                  state.rounding === opt.value
                    ? "bg-bg-dark text-text-inverse"
                    : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketplaceConfig({
  hasPfsConfig,
  pfsBrand: initialPfsBrand,
  hasAnkorstoreConfig,
  ankorstoreEnabled: initialAnkorstoreEnabled,
  markupSettings,
}: Props) {
  // ── PFS state ──────────────────────────────────────────────────────────────
  const [pfsEmail, setPfsEmail] = useState("");
  const [pfsPassword, setPfsPassword] = useState("");
  const [pfsStatus, setPfsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasPfsConfig ? "valid" : "none"
  );
  const [pfsEditing, setPfsEditing] = useState(!hasPfsConfig);
  const [isSavingPfs, startSavingPfs] = useTransition();
  const [isValidatingPfs, startValidatingPfs] = useTransition();
  const [pfsMarkup, setPfsMarkup] = useState<MarkupState>(markupSettings.pfs);

  // ── PFS brand state ────────────────────────────────────────────────────────
  const [pfsBrand, setPfsBrand] = useState<{ id: string; name: string } | null>(initialPfsBrand);
  const [brandList, setBrandList] = useState<{ id: string; name: string; logoUrl: string | null }[] | null>(null);
  const [brandListError, setBrandListError] = useState<string | null>(null);
  const [isLoadingBrands, startLoadingBrands] = useTransition();
  const [isSavingBrand, startSavingBrand] = useTransition();
  const [brandEditing, setBrandEditing] = useState(false);

  function openBrandPicker() {
    setBrandEditing(true);
    setBrandListError(null);
    startLoadingBrands(async () => {
      const res = await loadPfsBrands();
      if (res.success && res.brands) {
        setBrandList(res.brands);
      } else {
        setBrandListError(res.error ?? "Impossible de charger les marques.");
      }
    });
  }

  function handlePickBrand(brand: { id: string; name: string }) {
    showLoading();
    startSavingBrand(async () => {
      try {
        const res = await updatePfsBrand(brand);
        if (res.success) {
          setPfsBrand(brand);
          setBrandEditing(false);
          toast.success("Marque PFS enregistrée", `« ${brand.name} » est maintenant utilisée.`);
        } else {
          toast.error("Erreur", res.error ?? "Impossible d'enregistrer la marque.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  // ── Ankorstore state ────────────────────────────────────────────────────────
  const [ankorstoreClientId, setAnkorstoreClientId] = useState("");
  const [ankorstoreClientSecret, setAnkorstoreClientSecret] = useState("");
  const [ankorstoreStatus, setAnkorstoreStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasAnkorstoreConfig ? "valid" : "none"
  );
  const [ankorstoreEditing, setAnkorstoreEditing] = useState(!hasAnkorstoreConfig);
  const [isSavingAnkorstore, startSavingAnkorstore] = useTransition();
  const [isValidatingAnkorstore, startValidatingAnkorstore] = useTransition();
  const [isTogglingAnkorstore, startTogglingAnkorstore] = useTransition();
  const [ankorstoreEnabled, setAnkorstoreEnabled] = useState(initialAnkorstoreEnabled);

  const [ankorstoreWholesale, setAnkorstoreWholesale] = useState<MarkupState>(markupSettings.ankorstoreWholesale);
  const [ankorstoreRetail, setAnkorstoreRetail] = useState<MarkupState>(markupSettings.ankorstoreRetail);
  const [ankorstoreVatRate, setAnkorstoreVatRate] = useState<number>(markupSettings.ankorstoreVatRate);

  // ── Shared ──────────────────────────────────────────────────────────────────
  const [isSavingMarkup, startSavingMarkup] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const isPendingPfs = isSavingPfs || isValidatingPfs;
  const isPendingAnkorstore = isSavingAnkorstore || isValidatingAnkorstore;

  // ── PFS handlers ────────────────────────────────────────────────────────────
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

  // ── Ankorstore handlers ─────────────────────────────────────────────────────
  function handleAnkorstoreValidate() {
    if (!ankorstoreClientId.trim() || !ankorstoreClientSecret.trim()) return;
    showLoading();
    startValidatingAnkorstore(async () => {
      try {
        setAnkorstoreStatus("checking");
        const result = await validateAnkorstoreCredentials({
          clientId: ankorstoreClientId.trim(),
          clientSecret: ankorstoreClientSecret.trim(),
        });
        if (result.valid) {
          setAnkorstoreStatus("valid");
          toast.success("Connexion réussie", "Identifiants Ankorstore valides.");
        } else {
          setAnkorstoreStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleAnkorstoreSave() {
    showLoading();
    startSavingAnkorstore(async () => {
      try {
        const result = await updateAnkorstoreCredentials({
          clientId: ankorstoreClientId.trim(),
          clientSecret: ankorstoreClientSecret.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants Ankorstore sauvegardés.");
          setAnkorstoreEditing(false);
          setAnkorstoreClientId("");
          setAnkorstoreClientSecret("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleToggleAnkorstore(checked: boolean) {
    startTogglingAnkorstore(async () => {
      const result = await toggleAnkorstoreEnabled(checked);
      if (result.success) {
        setAnkorstoreEnabled(checked);
        toast.success(
          checked ? "Ankorstore activé" : "Ankorstore désactivé",
          checked
            ? "La synchronisation Ankorstore est maintenant active."
            : "La synchronisation Ankorstore est maintenant désactivée."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  // ── Markup save ─────────────────────────────────────────────────────────────
  function handleSaveMarkup() {
    showLoading();
    startSavingMarkup(async () => {
      try {
        const result = await updateMarketplaceMarkup({
          pfs: pfsMarkup,
          ankorstoreWholesale: ankorstoreWholesale,
          ankorstoreRetail: ankorstoreRetail,
          ankorstoreVatRate: ankorstoreVatRate,
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
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── PFS card ────────────────────────────────────────────────────── */}
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-bg-secondary/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-bg-dark/5 flex items-center justify-center">
                <IconShop className="w-[18px] h-[18px] text-text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-text-primary leading-tight">
                  Paris Fashion Shops
                </h3>
                <div className="mt-0.5">
                  <StatusBadge status={pfsStatus} />
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <IconKey className="w-4 h-4 text-text-muted" />
              <p className="font-body text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Connexion
              </p>
            </div>

            {!pfsEditing && hasPfsConfig ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-secondary/60">
                <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
                  ••••••••••••••••
                </div>
                <button
                  type="button"
                  onClick={() => setPfsEditing(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <IconPencil className="w-3.5 h-3.5" />
                  Modifier
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label className="font-body text-[11px] text-text-muted mb-1 block">Email</label>
                  <input
                    type="email"
                    value={pfsEmail}
                    onChange={(e) => {
                      setPfsEmail(e.target.value);
                      if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                    }}
                    placeholder="votre@email-pfs.com"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
                    disabled={isPendingPfs}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="font-body text-[11px] text-text-muted mb-1 block">Mot de passe</label>
                  <input
                    type="password"
                    value={pfsPassword}
                    onChange={(e) => {
                      setPfsPassword(e.target.value);
                      if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                    }}
                    placeholder="••••••••"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
                    disabled={isPendingPfs}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handlePfsValidate}
                    disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim()}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-xs font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
                  >
                    {isValidatingPfs ? (
                      <><IconLoader className="w-3.5 h-3.5" /> Vérification…</>
                    ) : (
                      <><IconCheck className="w-3.5 h-3.5" /> Tester la connexion</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handlePfsSave}
                    disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim() || pfsStatus !== "valid"}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                  >
                    {isSavingPfs ? "Enregistrement…" : "Sauvegarder"}
                  </button>
                  {hasPfsConfig && (
                    <button
                      type="button"
                      onClick={() => { setPfsEditing(false); setPfsEmail(""); setPfsPassword(""); setPfsStatus("valid"); }}
                      disabled={isPendingPfs}
                      className="inline-flex items-center gap-1 h-9 px-3 text-xs font-body text-text-muted hover:text-text-primary transition-colors"
                    >
                      <IconX className="w-3.5 h-3.5" />
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── PFS Marque ─────────────────────────────────────────────────── */}
          <div className="px-5 py-4 border-t border-border">
            <div className="flex items-center gap-2 mb-3">
              <IconTag className="w-4 h-4 text-text-muted" />
              <p className="font-body text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Marque utilisée
              </p>
            </div>
            {!hasPfsConfig ? (
              <p className="font-body text-xs text-text-muted">
                Renseignez vos identifiants PFS pour choisir une marque.
              </p>
            ) : !brandEditing ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-secondary/60">
                <div className={`flex-1 font-body text-sm ${pfsBrand ? "text-text-primary font-medium" : "text-text-muted italic"}`}>
                  {pfsBrand ? pfsBrand.name : "Aucune marque sélectionnée — PFS verrouillé"}
                </div>
                <button
                  type="button"
                  onClick={openBrandPicker}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <IconPencil className="w-3.5 h-3.5" />
                  {pfsBrand ? "Changer" : "Choisir"}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {isLoadingBrands && (
                  <div className="inline-flex items-center gap-2 text-xs font-body text-text-muted">
                    <IconLoader className="w-3.5 h-3.5" /> Chargement des marques…
                  </div>
                )}
                {brandListError && (
                  <p className="font-body text-xs text-error">{brandListError}</p>
                )}
                {brandList && brandList.length === 0 && (
                  <p className="font-body text-xs text-text-muted">Aucune marque disponible sur votre compte PFS.</p>
                )}
                {brandList && brandList.length > 0 && (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {brandList.map((b) => {
                      const isCurrent = pfsBrand?.id === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          disabled={isSavingBrand}
                          onClick={() => handlePickBrand({ id: b.id, name: b.name })}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${
                            isCurrent
                              ? "border-bg-dark bg-bg-dark/5"
                              : "border-border bg-bg-primary hover:bg-bg-secondary"
                          } disabled:opacity-50`}
                        >
                          <span className="flex-1 font-body text-sm text-text-primary">{b.name}</span>
                          {isCurrent && <IconCheck className="w-4 h-4 text-success" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setBrandEditing(false)}
                  className="inline-flex items-center gap-1 h-8 px-2 text-xs font-body text-text-muted hover:text-text-primary transition-colors"
                >
                  <IconX className="w-3.5 h-3.5" />
                  Fermer
                </button>
              </div>
            )}
            <p className="mt-2 font-body text-[11px] text-text-muted">
              Toutes les opérations PFS (création, modification, rafraîchissement, import)
              utilisent uniquement cette marque. Sans marque, PFS est verrouillé.
            </p>
          </div>

          <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 mt-auto">
            <div className="flex items-center gap-2 mb-4">
              <IconTag className="w-4 h-4 text-text-muted" />
              <p className="font-body text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Majoration des prix
              </p>
            </div>
            <MarkupRow label="Prix HT" state={pfsMarkup} onChange={setPfsMarkup} />
          </div>
        </div>

        {/* ── Ankorstore card ─────────────────────────────────────────────── */}
        <div className="bg-bg-primary border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-bg-secondary/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-bg-dark/5 flex items-center justify-center">
                <IconShop className="w-[18px] h-[18px] text-text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-text-primary leading-tight">
                  Ankorstore
                </h3>
                <div className="mt-0.5">
                  <StatusBadge status={ankorstoreStatus} />
                </div>
              </div>
            </div>
          </div>

          {/* Toggle activation */}
          <div className="px-5 pt-4 pb-3 border-b border-border/60">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={ankorstoreEnabled}
                  disabled={isTogglingAnkorstore}
                  onChange={(e) => handleToggleAnkorstore(e.target.checked)}
                />
                <div className="w-10 h-6 rounded-full border border-border bg-bg-secondary peer-checked:bg-bg-dark peer-checked:border-bg-dark transition-colors" />
                <div className="absolute top-1 left-1 w-4 h-4 rounded-full bg-text-muted peer-checked:bg-text-inverse peer-checked:translate-x-4 transition-all" />
              </div>
              <span className="font-body text-sm font-medium text-text-primary">
                Activer la sync Ankorstore
              </span>
              {isTogglingAnkorstore && <IconLoader className="w-4 h-4 text-text-muted" />}
            </label>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <IconKey className="w-4 h-4 text-text-muted" />
              <p className="font-body text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Connexion
              </p>
            </div>

            {!ankorstoreEditing && hasAnkorstoreConfig ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-secondary/60">
                <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
                  ••••••••••••••••
                </div>
                <button
                  type="button"
                  onClick={() => setAnkorstoreEditing(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-body font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <IconPencil className="w-3.5 h-3.5" />
                  Modifier
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div>
                  <label className="font-body text-[11px] text-text-muted mb-1 block">Client ID</label>
                  <input
                    type="text"
                    value={ankorstoreClientId}
                    onChange={(e) => {
                      setAnkorstoreClientId(e.target.value);
                      if (ankorstoreStatus === "valid" || ankorstoreStatus === "invalid") setAnkorstoreStatus("none");
                    }}
                    placeholder="votre-client-id"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
                    disabled={isPendingAnkorstore}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="font-body text-[11px] text-text-muted mb-1 block">Client Secret</label>
                  <input
                    type="password"
                    value={ankorstoreClientSecret}
                    onChange={(e) => {
                      setAnkorstoreClientSecret(e.target.value);
                      if (ankorstoreStatus === "valid" || ankorstoreStatus === "invalid") setAnkorstoreStatus("none");
                    }}
                    placeholder="••••••••"
                    className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
                    disabled={isPendingAnkorstore}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAnkorstoreValidate}
                    disabled={isPendingAnkorstore || !ankorstoreClientId.trim() || !ankorstoreClientSecret.trim()}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border text-xs font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
                  >
                    {isValidatingAnkorstore ? (
                      <><IconLoader className="w-3.5 h-3.5" /> Vérification…</>
                    ) : (
                      <><IconCheck className="w-3.5 h-3.5" /> Tester la connexion</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleAnkorstoreSave}
                    disabled={isPendingAnkorstore || !ankorstoreClientId.trim() || !ankorstoreClientSecret.trim() || ankorstoreStatus !== "valid"}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-xs font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                  >
                    {isSavingAnkorstore ? "Enregistrement…" : "Sauvegarder"}
                  </button>
                  {hasAnkorstoreConfig && (
                    <button
                      type="button"
                      onClick={() => { setAnkorstoreEditing(false); setAnkorstoreClientId(""); setAnkorstoreClientSecret(""); setAnkorstoreStatus("valid"); }}
                      disabled={isPendingAnkorstore}
                      className="inline-flex items-center gap-1 h-9 px-3 text-xs font-body text-text-muted hover:text-text-primary transition-colors"
                    >
                      <IconX className="w-3.5 h-3.5" />
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-border bg-bg-secondary/30 mt-auto space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <IconTag className="w-4 h-4 text-text-muted" />
              <p className="font-body text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Majoration des prix
              </p>
            </div>
            <MarkupRow label="Prix de gros" state={ankorstoreWholesale} onChange={setAnkorstoreWholesale} />
            <MarkupRow label="Prix public conseillé" state={ankorstoreRetail} onChange={setAnkorstoreRetail} />
            <div>
              <label className="font-body text-sm font-medium text-text-primary block mb-2">
                TVA par défaut (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={ankorstoreVatRate}
                onChange={(e) => setAnkorstoreVatRate(Number(e.target.value) || 0)}
                placeholder="20"
                className="w-24 h-9 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 transition-shadow"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSaveMarkup}
          disabled={isSavingMarkup}
          className="h-10 px-6 rounded-xl bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 shadow-sm"
        >
          {isSavingMarkup ? (
            <span className="inline-flex items-center gap-2">
              <IconLoader className="w-4 h-4" />
              Enregistrement…
            </span>
          ) : (
            "Sauvegarder les majorations"
          )}
        </button>
      </div>
    </div>
  );
}
