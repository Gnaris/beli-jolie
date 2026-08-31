"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { registerSchema } from "@/lib/validations/auth";
import StaffAvailability from "@/components/auth/StaffAvailability";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import { COUNTRIES, getCompanyZone, DOM_TOM_COUNTRIES } from "@/lib/vat";

type FieldErrors = Partial<Record<string, string>>;

const STEP_FIELDS: Record<number, readonly string[]> = {
  1: [
    "firstName", "lastName", "email", "phone",
    "addressStreet", "addressComplement", "addressZip", "addressCity", "addressCountry",
  ],
  2: ["company", "siret", "vatNumber", "businessRegistrationNumber", "registrationMessage"],
  3: ["password", "confirmPassword", "acceptsTerms"],
};

const TOTAL_STEPS = 3;

/** Clé localStorage pour le brouillon d'inscription. */
const REGISTER_DRAFT_KEY = "bj_register_draft_v1";
/** TTL du brouillon (7 jours). Au-delà, on repart de zéro. */
const REGISTER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Retourne la classe CSS flag-icons correspondant au code pays.
 * Les DOM-TOM affichent le drapeau français (cohérent avec le libellé
 * « France (…) ») plutôt qu'un drapeau régional peu reconnaissable.
 */
function flagClassForCountry(code: string): string {
  const upper = code.toUpperCase();
  if (upper === "FR" || DOM_TOM_COUNTRIES.has(upper)) return "fi fi-fr";
  return `fi fi-${upper.toLowerCase()}`;
}

export default function RegisterForm({
  productCount,
  todayHoursLabel,
  schedule,
}: {
  productCount?: number;
  todayHoursLabel?: string;
  schedule?: BusinessHoursSchedule;
}) {
  const t = useTranslations("auth.register");
  const toast = useToast();

  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
    siret: "",
    vatNumber: "",
    businessRegistrationNumber: "",
    addressStreet: "",
    addressComplement: "",
    addressZip: "",
    addressCity: "",
    addressCountry: "",
    password: "",
    confirmPassword: "",
    registrationMessage: "",
    acceptsTerms: false,
    acceptsNewsletter: false,
  });

  const countryOptions = useMemo<SelectOption[]>(() => {
    // Ordre du tableau COUNTRIES : France (Métropole + DOM-TOM) → UE → Monde.
    // Chaque option porte un vrai drapeau SVG via flag-icons.
    return COUNTRIES.map((c) => ({
      value: c.code,
      label: c.name,
      iconNode: (
        <span
          className={`${flagClassForCountry(c.code)} inline-block rounded-sm shadow-[0_0_0_1px_rgba(15,23,42,0.08)]`}
          style={{ width: "1.5rem", height: "1.125rem", backgroundSize: "cover" }}
          aria-hidden="true"
        />
      ),
    }));
  }, []);

  const companyZone = getCompanyZone(fields.addressCountry);
  const isZoneFr = companyZone === "FR";
  const isZoneEu = companyZone === "EU";
  const isZoneWorld = companyZone === "WORLD";

  const [kbisFile, setKbisFile]           = useState<File | null>(null);
  const [kbisError, setKbisError]         = useState("");
  const [docFile, setDocFile]             = useState<File | null>(null);
  const [docError, setDocError]           = useState("");
  const [fieldErrors, setFieldErrors]     = useState<FieldErrors>({});
  const [globalError, setGlobalError]     = useState("");
  const [staleVersion, setStaleVersion]   = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading]             = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [step, setStep]                   = useState(1);
  const [maxVisited, setMaxVisited]       = useState(1);
  // Flag pour bloquer la sauvegarde localStorage avant restauration —
  // sinon le premier render écrase le brouillon avec des valeurs vides.
  const [draftRestored, setDraftRestored] = useState(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const docInputRef                           = useRef<HTMLInputElement>(null);

  // ── Persistance localStorage — restaure le brouillon d'inscription ─
  // On sauvegarde tout le formulaire (SAUF mot de passe/confirmation qui
  // n'ont rien à faire dans localStorage) et l'étape en cours. Ainsi, si
  // la cliente ferme l'onglet, change de langue ou rafraîchit la page,
  // elle retrouve tous ses champs remplis au retour. TTL 7 jours.
  //
  // Les fichiers (Kbis, justificatif) NE PEUVENT PAS être persistés en
  // localStorage — l'utilisateur devra les re-sélectionner si le
  // navigateur est fermé (contrainte navigateur, pas un choix).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REGISTER_DRAFT_KEY);
      if (!raw) { setDraftRestored(true); return; }
      const saved = JSON.parse(raw) as {
        timestamp?: number;
        fields?: Partial<typeof fields>;
        step?: number;
        maxVisited?: number;
      } | null;
      if (saved?.timestamp && Date.now() - saved.timestamp > REGISTER_DRAFT_TTL_MS) {
        window.localStorage.removeItem(REGISTER_DRAFT_KEY);
        setDraftRestored(true);
        return;
      }
      if (saved?.fields) {
        setFields((prev) => ({ ...prev, ...saved.fields, password: "", confirmPassword: "" }));
      }
      if (typeof saved?.step === "number" && saved.step >= 1 && saved.step <= TOTAL_STEPS) {
        setStep(saved.step);
      }
      if (typeof saved?.maxVisited === "number") {
        setMaxVisited(Math.max(1, Math.min(saved.maxVisited, TOTAL_STEPS)));
      }
    } catch { /* ignore quota / JSON parse errors */ }
    setDraftRestored(true);
  }, []);

  useEffect(() => {
    if (!draftRestored) return;
    const timer = setTimeout(() => {
      try {
        // On exclut mot de passe et confirmation (données sensibles) et
        // acceptsTerms (case CGU — doit être ré-cochée par sécurité).
        const {
          password: _p, confirmPassword: _cp, acceptsTerms: _at, ...safeFields
        } = fields;
        void _p; void _cp; void _at;
        window.localStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({
          timestamp: Date.now(),
          fields: safeFields,
          step,
          maxVisited,
        }));
      } catch { /* quota exceeded */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [fields, step, maxVisited, draftRestored]);

  function setField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key as string]: undefined }));
  }
  function handleChange(field: keyof typeof fields, value: string) {
    setField(field, value as never);
  }

  function handleKbisChange(e: React.ChangeEvent<HTMLInputElement>) {
    setKbisError("");
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setKbisError(t("kbisInvalidFormat"));
      setKbisFile(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setKbisError(t("kbisTooBig"));
      setKbisFile(null);
      return;
    }
    setKbisFile(file);
  }

  function handleDocChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDocError("");
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    // .doc (application/msword, format OLE2) refusé pour cause de macros ;
    // n'accepte que .docx (OOXML) pour Word. Voir lib/upload-security.ts.
    const allowedTypes = [
      "application/pdf",
      "image/jpeg", "image/png", "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");

    if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(ext)) {
      setDocError(t("docInvalidFormat"));
      setDocFile(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setDocError(t("docTooBig"));
      setDocFile(null);
      return;
    }
    setDocFile(file);
  }

  function validateStep(current: number): boolean {
    const result = registerSchema.safeParse(fields);
    const stepKeys = new Set(STEP_FIELDS[current]);
    const errors: FieldErrors = {};
    let hasStepError = false;

    if (!result.success) {
      result.error.issues.forEach((err) => {
        const key = String(err.path[0]);
        if (stepKeys.has(key) && !errors[key]) {
          errors[key] = err.message;
          hasStepError = true;
        }
      });
    }

    // Étape 2 : justificatif obligatoire seulement hors UE (justificatif
    // d'entreprise). Le Kbis reste facultatif pour la France (l'admin peut
    // le demander par mail si le dossier manque de pièces).
    if (current === 2 && isZoneWorld && !docFile) {
      setDocError(t("businessProofRequired"));
      hasStepError = true;
    }

    if (hasStepError) {
      if (Object.keys(errors).length > 0) {
        setFieldErrors((prev) => ({ ...prev, ...errors }));
      }
      // Alerte visible en haut du formulaire pour signaler pourquoi le
      // bouton « Continuer » n'a pas marché.
      setGlobalError(t("wizardStepIncomplete"));
      // Toast — sur mobile, la cliente est souvent au niveau du bouton
      // « Continuer » (en bas de page) et ne voit pas le globalError du
      // haut du formulaire. Le toast est un signal fort visible même sans
      // scroller.
      const firstErrorKey = Object.keys(errors)[0];
      const uploadMissing = current === 2 && isZoneWorld && !docFile;
      const firstErrorMessage = firstErrorKey ? errors[firstErrorKey]
        : uploadMissing ? t("businessProofRequired") : undefined;
      toast.error(t("wizardStepIncomplete"), firstErrorMessage);
      if (firstErrorKey) {
        setTimeout(() => {
          const el = document.getElementById(firstErrorKey);
          // Pas de .focus() : sur mobile ça ouvre le clavier virtuel qui
          // masque les messages d'erreur juste posés. On scroll juste
          // le champ visible pour que la cliente voie l'erreur en dessous.
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      return false;
    }
    return true;
  }

  function goTo(target: number) {
    if (target < 1 || target > TOTAL_STEPS) return;
    if (target > step) {
      if (!validateStep(step)) return;
    }
    setStep(target);
    setMaxVisited((prev) => Math.max(prev, target));
    setGlobalError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setGlobalError("");
    setStaleVersion(false);

    const validation = registerSchema.safeParse(fields);
    if (!validation.success) {
      const errors: FieldErrors = {};
      let firstErrorStep = TOTAL_STEPS;
      validation.error.issues.forEach((err) => {
        const key = String(err.path[0]);
        if (!errors[key]) errors[key] = err.message;
        for (const [s, keys] of Object.entries(STEP_FIELDS)) {
          if ((keys as readonly string[]).includes(key)) {
            firstErrorStep = Math.min(firstErrorStep, Number(s));
            break;
          }
        }
      });
      setFieldErrors(errors);
      if (firstErrorStep !== step) {
        setStep(firstErrorStep);
        setMaxVisited((prev) => Math.max(prev, firstErrorStep));
      }
      setTimeout(() => {
        const firstErrorKey = Object.keys(errors)[0];
        if (firstErrorKey) {
          const el = document.getElementById(firstErrorKey);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          // Pas de .focus() : sur mobile ça ouvre le clavier qui masque
          // le message d'erreur juste posé.
        }
      }, 100);
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      Object.entries(fields).forEach(([key, val]) => formData.append(key, String(val)));
      if (kbisFile) formData.append("kbis", kbisFile);
      if (docFile) formData.append("document", docFile);

      const res = await fetch("/api/auth/register", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        // 500 générique = souvent un ChunkLoadError SSR après déploiement
        // pendant que la cliente remplissait le formulaire. Message dédié
        // qui l'invite à recharger plutôt que le message serveur brut.
        if (res.status === 500) {
          setStaleVersion(true);
          setGlobalError(t("staleVersionError"));
        } else {
          setGlobalError(json.error ?? t("kbisRequired"));
        }
        return;
      }
      // Inscription réussie : on efface le brouillon local.
      try { window.localStorage.removeItem(REGISTER_DRAFT_KEY); } catch { /* ignore */ }

      // Auto-login : le compte est PENDING mais on connecte la cliente
      // immédiatement pour qu'elle puisse naviguer (prix restent masqués
      // tant que l'admin n'a pas validé). Sur échec de signIn, on retombe
      // sur l'écran de succès pour ne pas la laisser sans feedback.
      const signInRes = await signIn("credentials", {
        email: fields.email.toLowerCase().trim(),
        password: fields.password,
        redirect: false,
      });
      if (signInRes?.ok) {
        window.location.href = "/";
        return;
      }
      setSuccessMessage(json.message);
    } catch {
      setGlobalError(t("kbisRequired"));
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────────────
  // ÉCRAN DE SUCCÈS
  // ────────────────────────────────────────────────────────
  if (successMessage) {
    return (
      <div className="w-full max-w-xl mx-auto">
        <div className="bg-bg-primary rounded-3xl border border-border p-10 md:p-12 shadow-card-lg text-center">
          <div className="w-16 h-16 bg-success/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-heading text-2xl md:text-3xl font-semibold text-text-primary mb-3 tracking-tight">
            {t("successTitle")}
          </h2>
          <p className="font-body text-text-muted text-sm md:text-base leading-relaxed mb-8 max-w-md mx-auto">
            {successMessage}
          </p>
          <Link href="/" className="btn-primary justify-center">
            {t("backHome")}
          </Link>
        </div>
      </div>
    );
  }

  const formattedCount = productCount
    ? new Intl.NumberFormat("fr-FR").format(productCount)
    : null;
  const progressPct = Math.round((step / TOTAL_STEPS) * 100);

  const steps = [
    { n: 1, label: t("wizardStep1Label"), desc: t("wizardStep1Desc") },
    { n: 2, label: t("wizardStep2Label"), desc: t("wizardStep2Desc") },
    { n: 3, label: t("wizardStep3Label"), desc: t("wizardStep3Desc") },
  ];
  const currentStepMeta = steps[step - 1];

  // ────────────────────────────────────────────────────────
  // WIZARD
  // ────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-6xl mx-auto">

      {/* ── Hero ── */}
      <header className="text-center mb-8 md:mb-12">
        <div className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-[11px] font-body font-semibold px-3.5 py-1.5 rounded-full mb-4 uppercase tracking-[0.18em]">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" />
          </svg>
          {t("heroBanner")}
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary tracking-tight leading-tight">
          {t("title")}
        </h1>
        <p className="mt-3 font-body text-text-muted max-w-md mx-auto leading-relaxed">
          {t("subtitle")}
        </p>
      </header>

      <div className="grid md:grid-cols-[260px_1fr] lg:grid-cols-[280px_1fr] gap-6 lg:gap-10">

        {/* ── Aside desktop ── */}
        <aside className="hidden md:block">
          <div className="sticky top-24 space-y-5">
            <nav aria-label={t("wizardProgressionLabel")} className="bg-bg-primary/60 border border-border rounded-2xl p-2">
              <p className="px-3 pt-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                {t("wizardProgressionLabel")}
              </p>
              <ol className="space-y-1">
                {steps.map((s) => {
                  const state: "current" | "done" | "locked" = s.n === step
                    ? "current"
                    : (s.n < step ? "done" : "locked");
                  const canGo = s.n <= maxVisited;
                  return (
                    <li key={s.n}>
                      <button
                        type="button"
                        onClick={() => canGo && goTo(s.n)}
                        disabled={!canGo}
                        className={`w-full flex gap-3.5 items-start p-2.5 rounded-xl transition-colors text-left ${
                          state === "current" ? "bg-bg-primary shadow-sm" :
                          state === "done"    ? "hover:bg-bg-tertiary cursor-pointer" :
                          "opacity-60 cursor-not-allowed"
                        }`}
                        aria-current={state === "current" ? "step" : undefined}
                      >
                        <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-heading font-bold border transition-all ${
                          state === "current" ? "bg-text-primary text-text-inverse border-text-primary ring-4 ring-text-primary/10" :
                          state === "done"    ? "bg-text-secondary text-text-inverse border-text-secondary" :
                          "bg-bg-tertiary text-text-secondary border-border-dark border-dashed"
                        }`}>
                          {state === "done" ? (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : String(s.n).padStart(2, "0")}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-heading text-[0.82rem] font-semibold text-text-primary leading-tight">
                            {s.label}
                          </span>
                          <span className="block text-[0.72rem] text-text-muted mt-0.5 leading-snug">
                            {s.desc}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                {t("wizardWhyUs")}
              </p>
              {formattedCount && (
                <TrustItem
                  value={formattedCount}
                  label={t("wizardWhyReferences")}
                  icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />}
                />
              )}
              <TrustItem
                value={todayHoursLabel ?? t("trustHoursDefault")}
                label={t("wizardWhyValidation")}
                icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />}
              />
              <TrustItem
                value={t("trustHTPrice")}
                label={t("wizardWhyPrice")}
                icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />}
              />
            </div>

            {schedule && (
              <div className="rounded-2xl overflow-hidden">
                <StaffAvailability schedule={schedule} />
              </div>
            )}
          </div>
        </aside>

        {/* ── Contenu wizard ── */}
        <section>

          {/* Progress mobile (md:hidden) */}
          <div className="md:hidden mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                {t("wizardStepLabel")} {step}/{TOTAL_STEPS}
              </span>
              <span className="text-xs font-medium text-text-primary">{currentStepMeta.label}</span>
            </div>
            <div className="h-1 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className="h-full bg-text-primary rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Erreur globale */}
          {globalError && (
            <div role="alert" className="bg-red-50 border border-red-200 text-error px-4 py-3.5 text-sm font-body flex items-start gap-2.5 mb-6 rounded-xl">
              <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div className="flex-1 flex flex-col gap-2">
                <span>{globalError}</span>
                {staleVersion && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="self-start bg-error text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-error/90 transition-colors"
                  >
                    {t("reloadPage")}
                  </button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate encType="multipart/form-data">

            {/* ── Étape 1 : Contact & adresse ── */}
            {step === 1 && (
              <StepCard eyebrow={`01 · ${t("section1Title")}`} title={t("wizardStep1Label")} description={t("section1Desc")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField id="firstName" label={t("firstName")} type="text"
                    value={fields.firstName} error={fieldErrors.firstName}
                    placeholder={t("firstNamePlaceholder")} autoComplete="given-name" optional
                    onChange={(v) => handleChange("firstName", v)} />
                  <FormField id="lastName" label={t("lastName")} type="text"
                    value={fields.lastName} error={fieldErrors.lastName}
                    placeholder={t("lastNamePlaceholder")} autoComplete="family-name" optional
                    onChange={(v) => handleChange("lastName", v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField id="email" label={t("email")} type="email"
                    value={fields.email} error={fieldErrors.email}
                    placeholder={t("emailPlaceholder")} autoComplete="email"
                    onChange={(v) => handleChange("email", v)} />
                  <FormField id="phone" label={t("phone")} type="tel"
                    value={fields.phone} error={fieldErrors.phone}
                    placeholder={t("phonePlaceholder")} autoComplete="tel"
                    onChange={(v) => handleChange("phone", v)} />
                </div>

                {/* Sous-section adresse postale */}
                <div className="pt-2">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                      {t("addressSubsection")}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <FormField id="addressStreet" label={t("addressLabel")} type="text"
                    value={fields.addressStreet} error={fieldErrors.addressStreet}
                    placeholder={t("addressStreetPlaceholder")} autoComplete="street-address"
                    onChange={(v) => handleChange("addressStreet", v)} />
                  <div className="mt-4">
                    <FormField id="addressComplement" label={t("addressComplement")} type="text"
                      value={fields.addressComplement} error={fieldErrors.addressComplement}
                      placeholder={t("addressComplementPlaceholder")} autoComplete="address-line2" optional
                      onChange={(v) => handleChange("addressComplement", v)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                    <FormField id="addressZip" label={t("addressZip")} type="text"
                      value={fields.addressZip} error={fieldErrors.addressZip}
                      placeholder={t("addressZipPlaceholder")} autoComplete="postal-code"
                      onChange={(v) => handleChange("addressZip", v)} />
                    <div className="sm:col-span-2">
                      <FormField id="addressCity" label={t("addressCity")} type="text"
                        value={fields.addressCity} error={fieldErrors.addressCity}
                        placeholder={t("addressCityPlaceholder")} autoComplete="address-level2"
                        onChange={(v) => handleChange("addressCity", v)} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <FieldLabel id="addressCountry">{t("addressCountry")}</FieldLabel>
                    <CustomSelect
                      id="addressCountry"
                      value={fields.addressCountry}
                      onChange={(v) => handleChange("addressCountry", v)}
                      options={countryOptions}
                      searchable
                      placeholder={t("selectCountry")}
                      aria-label={t("countryAriaLabel")}
                    />
                    {fieldErrors.addressCountry && (
                      <p className="text-xs text-error mt-1 font-body">{fieldErrors.addressCountry}</p>
                    )}
                  </div>
                </div>
              </StepCard>
            )}

            {/* ── Étape 2 : Société & justificatif ── */}
            {step === 2 && (
              <StepCard eyebrow={`02 · ${t("section2Title")}`} title={t("wizardStep2Label")} description={t("section2Desc")}>
                <FormField id="company" label={t("company")} type="text"
                  value={fields.company} error={fieldErrors.company}
                  placeholder={t("companyPlaceholder")} autoComplete="organization"
                  onChange={(v) => handleChange("company", v)} />

                {/* Champs légaux conditionnels selon la zone du pays */}
                {isZoneFr && (
                  <>
                    <div>
                      <FormField id="siret" label={t("siret")} type="text"
                        value={fields.siret} error={fieldErrors.siret}
                        placeholder={t("siretPlaceholder")} maxLength={14} mono
                        onChange={(v) => handleChange("siret", v.replace(/\D/g, ""))} />
                      <p className="text-xs text-text-muted mt-1.5 font-body">{t("siretHint")}</p>
                    </div>
                    <div>
                      <FieldLabel id="vatNumber" optional>{t("vatNumber")}</FieldLabel>
                      <input
                        id="vatNumber" type="text" value={fields.vatNumber}
                        onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
                        placeholder={t("vatPlaceholder")} maxLength={20}
                        className={`field-input font-mono tracking-wide ${fieldErrors.vatNumber ? "border-error" : ""}`}
                      />
                      {fieldErrors.vatNumber && <p className="text-xs text-error mt-1">{fieldErrors.vatNumber}</p>}
                    </div>
                  </>
                )}

                {isZoneEu && (
                  <>
                    <div>
                      <FieldLabel id="businessRegistrationNumber" optional>{t("businessRegistrationNumber")}</FieldLabel>
                      <input
                        id="businessRegistrationNumber" type="text"
                        value={fields.businessRegistrationNumber}
                        onChange={(e) => handleChange("businessRegistrationNumber", e.target.value)}
                        placeholder={t("businessRegistrationNumberPlaceholder")}
                        maxLength={32}
                        className={`field-input font-mono tracking-wide ${fieldErrors.businessRegistrationNumber ? "border-error" : ""}`}
                      />
                      <p className="text-xs text-text-muted mt-1.5 font-body">{t("businessRegistrationNumberHint")}</p>
                      {fieldErrors.businessRegistrationNumber && (
                        <p className="text-xs text-error mt-1">{fieldErrors.businessRegistrationNumber}</p>
                      )}
                    </div>
                    <div>
                      <FieldLabel id="vatNumber">{t("vatNumber")}</FieldLabel>
                      <input
                        id="vatNumber" type="text" value={fields.vatNumber}
                        onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
                        placeholder={t("vatPlaceholder")} maxLength={20}
                        className={`field-input font-mono tracking-wide ${fieldErrors.vatNumber ? "border-error" : ""}`}
                      />
                      <p className="text-xs text-text-muted mt-1.5 font-body">{t("vatNumberHint")}</p>
                      {fieldErrors.vatNumber && <p className="text-xs text-error mt-1">{fieldErrors.vatNumber}</p>}
                      <div className="mt-4 flex items-start gap-3 bg-[#FFFBEB] border border-[#FCD34D] rounded-xl p-4">
                        <div className="w-8 h-8 bg-[#FCD34D]/40 rounded-lg flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-[#B45309]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm9-3.75a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="text-sm font-body text-[#7C2D12] leading-relaxed">
                          <p className="font-semibold mb-1.5">{t("euVatTitle")}</p>
                          <p className="text-xs leading-relaxed">
                            {t("euVatDescPart1")} <strong>{t("euVatDescStrong1")}</strong>
                            {t("euVatDescPart2")} <strong>{t("euVatDescStrong2")}</strong> {t("euVatDescPart3")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {isZoneWorld && (
                  <div>
                    <FieldLabel id="businessRegistrationNumber" optional>{t("businessRegistrationNumber")}</FieldLabel>
                    <input
                      id="businessRegistrationNumber" type="text"
                      value={fields.businessRegistrationNumber}
                      onChange={(e) => handleChange("businessRegistrationNumber", e.target.value)}
                      placeholder={t("businessRegistrationNumberPlaceholder")}
                      maxLength={32}
                      className={`field-input font-mono tracking-wide ${fieldErrors.businessRegistrationNumber ? "border-error" : ""}`}
                    />
                    <p className="text-xs text-text-muted mt-1.5 font-body">{t("businessRegistrationNumberHint")}</p>
                    {fieldErrors.businessRegistrationNumber && (
                      <p className="text-xs text-error mt-1">{fieldErrors.businessRegistrationNumber}</p>
                    )}
                  </div>
                )}

                {/* Justificatif — obligatoire pour FR (Kbis) et WORLD (justif d'entreprise) */}
                {(isZoneFr || isZoneWorld) && (
                  <div className="pt-2">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                        {t("proofSubsection")}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {isZoneFr ? (
                      <UploadField
                        id="kbis"
                        label={t("kbis")}
                        description={t("kbisFormats")}
                        file={kbisFile} error={kbisError} inputRef={fileInputRef}
                        accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleKbisChange}
                        onClear={() => { setKbisFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      />
                    ) : (
                      <UploadField
                        id="document"
                        label={t("businessProofLabel")}
                        description={t("businessProofDesc")}
                        required
                        file={docFile} error={docError} inputRef={docInputRef}
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" onChange={handleDocChange}
                        onClear={() => { setDocFile(null); if (docInputRef.current) docInputRef.current.value = ""; }}
                      />
                    )}
                  </div>
                )}

                {/* Message facultatif */}
                <div>
                  <FieldLabel id="registrationMessage" optional>{t("message")}</FieldLabel>
                  <textarea
                    id="registrationMessage"
                    value={fields.registrationMessage}
                    onChange={(e) => handleChange("registrationMessage", e.target.value)}
                    placeholder={t("messagePlaceholder")}
                    maxLength={2000}
                    rows={4}
                    className={`field-input resize-y min-h-[110px] ${fieldErrors.registrationMessage ? "border-error" : ""}`}
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-xs text-text-muted font-body">{t("messageHint")}</p>
                    <span className="text-xs text-text-muted font-body tabular-nums">
                      {fields.registrationMessage.length}/2000
                    </span>
                  </div>
                  {fieldErrors.registrationMessage && (
                    <p className="text-xs text-error mt-1">{fieldErrors.registrationMessage}</p>
                  )}
                </div>
              </StepCard>
            )}

            {/* ── Étape 3 : Sécurité + Récap + Consentements ── */}
            {step === 3 && (
              <div className="space-y-5">
                <StepCard eyebrow={`03 · ${t("section3Title")}`} title={t("wizardStep3Label")} description={t("section3Desc")}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <FieldLabel id="password">{t("password")}</FieldLabel>
                      <div className="relative">
                        <input
                          id="password" type={showPassword ? "text" : "password"}
                          value={fields.password}
                          onChange={(e) => handleChange("password", e.target.value)}
                          placeholder="••••••••" autoComplete="new-password"
                          className={`field-input pr-12 ${fieldErrors.password ? "border-error" : ""}`}
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={showPassword
                              ? "M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                              : "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z"} />
                          </svg>
                        </button>
                      </div>
                      {fieldErrors.password && <p className="text-xs text-error mt-1">{fieldErrors.password}</p>}
                      <PasswordStrength password={fields.password} />
                    </div>
                    <FormField id="confirmPassword" label={t("confirm")} type="password"
                      value={fields.confirmPassword} error={fieldErrors.confirmPassword}
                      placeholder="••••••••" autoComplete="new-password"
                      onChange={(v) => handleChange("confirmPassword", v)} />
                  </div>
                </StepCard>

                {/* Récap */}
                <div className="bg-bg-primary border border-border rounded-2xl shadow-card p-6 md:p-8">
                  <header className="mb-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted mb-2">
                      {t("wizardSummaryEyebrow")}
                    </p>
                    <h3 className="font-heading text-lg font-bold text-text-primary">{t("wizardSummaryTitle")}</h3>
                    <p className="text-sm text-text-muted mt-1">{t("wizardSummarySubtitle")}</p>
                  </header>
                  <dl className="divide-y divide-border-light text-sm">
                    <SummaryRow label={t("wizardSummaryContact")}>
                      {[
                        [fields.firstName, fields.lastName].filter(Boolean).join(" ") || null,
                        fields.email,
                        fields.phone,
                      ].filter(Boolean).join(" · ") || "—"}
                    </SummaryRow>
                    <SummaryRow label={t("wizardSummaryCompany")}>
                      {[
                        fields.company,
                        fields.siret ? `SIRET ${fields.siret}` : null,
                        fields.vatNumber ? `TVA ${fields.vatNumber}` : null,
                        fields.businessRegistrationNumber ? `N° ${fields.businessRegistrationNumber}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </SummaryRow>
                    <SummaryRow label={t("wizardSummaryAddress")}>
                      {[
                        fields.addressStreet,
                        fields.addressComplement,
                        [fields.addressZip, fields.addressCity].filter(Boolean).join(" "),
                        fields.addressCountry,
                      ].filter(Boolean).join(", ") || "—"}
                    </SummaryRow>
                    <SummaryRow label={t("wizardSummaryDocs")}>
                      {[kbisFile?.name, docFile?.name].filter(Boolean).join(" · ") || t("wizardSummaryNoDocs")}
                    </SummaryRow>
                  </dl>
                </div>

                {/* Consentements + Submit */}
                <div className="bg-bg-primary border border-border rounded-2xl shadow-card p-6 md:p-8">
                  <header className="mb-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted mb-2">
                      {t("wizardConsentEyebrow")}
                    </p>
                    <h3 className="font-heading text-lg font-bold text-text-primary">{t("wizardConsentTitle")}</h3>
                    <p className="text-sm text-text-muted mt-1">{t("wizardConsentSubtitle")}</p>
                  </header>

                  <div className="space-y-3 mb-6">
                    {/* CGU (obligatoire) */}
                    <label className={`flex items-start gap-3 p-3.5 border rounded-xl cursor-pointer transition-colors ${
                      fieldErrors.acceptsTerms ? "border-error bg-red-50" : "border-border hover:bg-bg-secondary"
                    }`}>
                      <input
                        id="acceptsTerms"
                        type="checkbox"
                        checked={fields.acceptsTerms}
                        onChange={(e) => setField("acceptsTerms", e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-border-dark accent-text-primary"
                      />
                      <span className="flex-1 text-sm text-text-primary">
                        <span className="font-medium">{t("wizardTermsLabel")}</span>
                        <span className="block text-xs text-text-muted mt-0.5">
                          {t("wizardTermsDesc")} · {" "}
                          <Link href="/cgu" target="_blank" className="underline underline-offset-2">
                            {t("wizardTermsCgu")}
                          </Link>
                          {" · "}
                          <Link href="/confidentialite" target="_blank" className="underline underline-offset-2">
                            {t("wizardTermsPrivacy")}
                          </Link>
                        </span>
                        {fieldErrors.acceptsTerms && (
                          <span className="block text-xs text-error mt-1">{fieldErrors.acceptsTerms}</span>
                        )}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-bg-dark text-text-inverse px-2 py-0.5 rounded-full shrink-0">
                        {t("wizardTermsRequired")}
                      </span>
                    </label>

                    {/* Newsletter (facultative) */}
                    <label className="flex items-start gap-3 p-3.5 border border-border rounded-xl cursor-pointer hover:bg-bg-secondary transition-colors">
                      <input
                        id="acceptsNewsletter"
                        type="checkbox"
                        checked={fields.acceptsNewsletter}
                        onChange={(e) => setField("acceptsNewsletter", e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-border-dark accent-text-primary"
                      />
                      <span className="flex-1 text-sm font-medium text-text-primary">
                        {t("wizardNewsletterLabel")}
                      </span>
                    </label>
                  </div>

                  <button
                    type="submit" disabled={loading}
                    className="btn-primary w-full justify-center text-base py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {t("loading")}
                      </>
                    ) : (
                      <>
                        {t("submit")}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </>
                    )}
                  </button>

                  <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-body text-text-muted">
                    <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
                    </svg>
                    {t("wizardReassurance")}
                  </div>
                </div>
              </div>
            )}

            {/* ── Barre nav Prev / Next ── */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => goTo(step - 1)}
                disabled={step === 1}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-border-strong bg-bg-primary text-sm font-medium text-text-primary transition-colors hover:border-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t("wizardPrev")}
              </button>

              <div className="hidden sm:flex items-center gap-1.5 text-xs text-text-muted">
                <span className="tabular-nums font-medium text-text-secondary">{step}</span>
                <span>{t("wizardStepOf")}</span>
                <span className="tabular-nums font-medium text-text-secondary">{TOTAL_STEPS}</span>
              </div>

              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={() => goTo(step + 1)}
                  className="btn-primary"
                >
                  {t("wizardNext")}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <span className="text-xs text-text-muted sm:hidden">
                  {t("hasAccount")}{" "}
                  <Link href="/connexion" className="text-text-primary font-medium underline underline-offset-2">
                    {t("loginLink")}
                  </Link>
                </span>
              )}
            </div>

            {step < TOTAL_STEPS && (
              <p className="mt-6 text-center text-xs text-text-muted">
                {t("hasAccount")}{" "}
                <Link href="/connexion" className="text-text-primary font-medium underline underline-offset-2">
                  {t("loginLink")}
                </Link>
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers visuels
// ────────────────────────────────────────────────────────────

function StepCard({
  eyebrow, title, description, children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-bg-primary border border-border rounded-2xl shadow-card p-6 md:p-8">
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-muted mb-2">
          {eyebrow}
        </p>
        <h2 className="font-heading text-xl md:text-2xl font-bold text-text-primary tracking-tight">
          {title}
        </h2>
        <p className="text-sm text-text-muted mt-1 leading-relaxed">{description}</p>
      </header>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}

function TrustItem({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-bg-primary border border-border rounded-xl">
      <div className="w-8 h-8 rounded-lg bg-bg-tertiary flex items-center justify-center shrink-0 text-text-primary">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
      </div>
      <div>
        <div className="font-heading font-bold text-sm text-text-primary leading-none">{value}</div>
        <div className="text-[11px] text-text-muted mt-1">{label}</div>
      </div>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] sm:grid-cols-[120px_1fr] gap-3 py-2.5">
      <dt className="text-text-muted font-medium">{label}</dt>
      <dd className="text-text-primary break-words">{children}</dd>
    </div>
  );
}

function FieldLabel({ id, children, optional }: { id: string; children: React.ReactNode; optional?: boolean }) {
  const t = useTranslations("auth.register");
  return (
    <label htmlFor={id} className="flex items-baseline justify-between text-sm font-body font-medium text-text-primary mb-1.5">
      <span>{children}</span>
      {optional ? (
        <span className="text-xs text-text-muted font-normal normal-case">{t("optionalLabel")}</span>
      ) : (
        <span className="text-xs text-error font-normal" aria-hidden>•</span>
      )}
    </label>
  );
}

function FormField({
  id, label, type, value, error, placeholder, autoComplete, maxLength, optional, mono, onChange,
}: {
  id: string; label: string; type: string; value: string;
  error?: string; placeholder?: string; autoComplete?: string;
  maxLength?: number; optional?: boolean; mono?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <FieldLabel id={id} optional={optional}>{label}</FieldLabel>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        maxLength={maxLength} required={!optional}
        className={`field-input ${mono ? "font-mono tracking-wide" : ""} ${error ? "border-error" : ""}`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-error mt-1.5 font-body">{error}</p>}
    </div>
  );
}

function UploadField({
  id, label, description, file, error, inputRef, accept, onChange, onClear, required,
}: {
  id: string;
  label: string;
  description: string;
  file: File | null;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  required?: boolean;
}) {
  const tReg = useTranslations("auth.register");
  return (
    <div>
      <FieldLabel id={id} optional={!required}>{label}</FieldLabel>
      <div
        className={`relative border-2 border-dashed rounded-xl transition-all cursor-pointer ${
          error
            ? "border-error bg-red-50"
            : file
              ? "border-success bg-success/5"
              : "border-border bg-bg-secondary hover:border-text-muted hover:bg-bg-tertiary"
        } p-5`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        role="button" tabIndex={0} aria-label={`Choisir un fichier pour ${label}`}
      >
        <input ref={inputRef} id={id} type="file"
          accept={accept} onChange={onChange} className="sr-only" />

        {file ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-body font-medium text-text-primary truncate">{file.name}</p>
              <p className="text-xs text-text-muted font-body">
                {(file.size / 1024).toFixed(0)} Ko — Cliquez pour changer
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="text-text-muted hover:text-error transition-colors p-1"
              aria-label="Retirer ce fichier"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-bg-primary border border-border flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-body font-medium text-text-primary">{tReg("uploadTeleverser")}</p>
              <p className="text-xs text-text-muted font-body mt-0.5">{description}</p>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-error mt-1.5 font-body" role="alert">{error}</p>}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations("auth.register");
  const checks = [
    { label: t("requirements8chars"), ok: password.length >= 8 },
    { label: t("requirementsUppercase"), ok: /[A-Z]/.test(password) },
    { label: t("requirementsDigit"), ok: /[0-9]/.test(password) },
  ];
  if (!password) {
    return (
      <p className="text-xs text-text-muted mt-1.5 font-body">
        8 caractères, 1 majuscule, 1 chiffre.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {checks.map((c) => (
        <span key={c.label} className={`flex items-center gap-1 text-[11px] font-body ${
          c.ok ? "text-success" : "text-text-muted"
        }`}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {c.ok
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              : <circle cx="12" cy="12" r="9" strokeWidth={1.5} />}
          </svg>
          {c.label}
        </span>
      ))}
    </div>
  );
}
