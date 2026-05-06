"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { registerSchema } from "@/lib/validations/auth";
import StaffAvailability from "@/components/auth/StaffAvailability";
import type { BusinessHoursSchedule } from "@/lib/business-hours";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { COUNTRIES, isEuNonFrance } from "@/lib/vat";

type FieldErrors = Partial<Record<string, string>>;

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

  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
    siret: "",
    vatNumber: "",
    addressStreet: "",
    addressComplement: "",
    addressZip: "",
    addressCity: "",
    addressCountry: "FR",
    password: "",
    confirmPassword: "",
    registrationMessage: "",
  });

  const countryOptions = useMemo<SelectOption[]>(() => {
    const eu = COUNTRIES.filter((c) => c.region === "EU");
    const dom = COUNTRIES.filter((c) => c.region === "DOM_TOM");
    const world = COUNTRIES.filter((c) => c.region === "WORLD");
    return [
      ...eu.map((c) => ({ value: c.code, label: `🇪🇺  ${c.name}` })),
      ...dom.map((c) => ({ value: c.code, label: `🏝  ${c.name}` })),
      ...world.map((c) => ({ value: c.code, label: c.name })),
    ];
  }, []);

  const showEuVatNotice = isEuNonFrance(fields.addressCountry);

  const [kbisFile, setKbisFile]           = useState<File | null>(null);
  const [kbisError, setKbisError]         = useState("");
  const [docFile, setDocFile]             = useState<File | null>(null);
  const [docError, setDocError]           = useState("");
  const [fieldErrors, setFieldErrors]     = useState<FieldErrors>({});
  const [globalError, setGlobalError]     = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading]             = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [autoApproved, setAutoApproved]       = useState(false);
  const [inviteCode, setInviteCode]           = useState("");
  const [inviteStatus, setInviteStatus]       = useState<"idle" | "validating" | "valid" | "error">("idle");
  const [inviteError, setInviteError]         = useState("");
  const [inviteOpen, setInviteOpen]           = useState(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const docInputRef                           = useRef<HTMLInputElement>(null);

  function applyPrefill(prefill: Record<string, string>) {
    setFields((prev) => {
      const updated = { ...prev };
      // On ne pré-remplit jamais un champ déjà rempli par l'utilisateur
      if (prefill.firstName && !prev.firstName)                 updated.firstName         = prefill.firstName;
      if (prefill.lastName && !prev.lastName)                   updated.lastName          = prefill.lastName;
      if (prefill.company && !prev.company)                     updated.company           = prefill.company;
      if (prefill.email && !prev.email)                         updated.email             = prefill.email;
      if (prefill.phone && !prev.phone)                         updated.phone             = prefill.phone;
      if (prefill.siret && !prev.siret)                         updated.siret             = prefill.siret;
      if (prefill.vatNumber && !prev.vatNumber)                 updated.vatNumber         = prefill.vatNumber;
      if (prefill.addressStreet && !prev.addressStreet)         updated.addressStreet     = prefill.addressStreet;
      if (prefill.addressComplement && !prev.addressComplement) updated.addressComplement = prefill.addressComplement;
      if (prefill.addressZip && !prev.addressZip)               updated.addressZip        = prefill.addressZip;
      if (prefill.addressCity && !prev.addressCity)             updated.addressCity       = prefill.addressCity;
      // Pour le pays, on pré-remplit même si la valeur par défaut "FR" est encore là.
      if (prefill.addressCountry && (prev.addressCountry === "FR" || !prev.addressCountry)) {
        updated.addressCountry = prefill.addressCountry;
      }
      return updated;
    });
  }

  // Pré-remplir si cookie bj_access_code existe
  useEffect(() => {
    const match = document.cookie.match(/bj_access_code=([^;]+)/);
    if (match) {
      const code = decodeURIComponent(match[1]);
      setInviteCode(code);
      setInviteStatus("valid");
      setInviteOpen(true);
      fetch("/api/access-code/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
        .then((res) => res.json())
        .then((json) => {
          if (json.prefill) applyPrefill(json.prefill);
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function validateInviteCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) {
      setInviteStatus("idle");
      setInviteError("");
      return;
    }
    setInviteStatus("validating");
    setInviteError("");
    try {
      const res = await fetch("/api/access-code/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = await res.json();
      if (res.ok) {
        setInviteStatus("valid");
        setInviteError("");
        if (json.prefill) applyPrefill(json.prefill);
      } else {
        setInviteStatus("error");
        setInviteError(json.error ?? "Code invalide.");
      }
    } catch {
      setInviteStatus("error");
      setInviteError("Erreur de connexion.");
    }
  }

  function handleChange(field: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
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

    const allowedTypes = [
      "application/pdf",
      "image/jpeg", "image/png", "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"];
    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");

    if (!allowedTypes.includes(file.type) || !allowedExtensions.includes(ext)) {
      setDocError("Format invalide. Accepté : PDF, JPG, PNG, DOC, DOCX.");
      setDocFile(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setDocError("Le fichier ne doit pas dépasser 10 Mo.");
      setDocFile(null);
      return;
    }
    setDocFile(file);
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setGlobalError("");
    setFieldErrors({});

    const validation = registerSchema.safeParse(fields);
    if (!validation.success) {
      const errors: FieldErrors = {};
      validation.error.issues.forEach((err) => {
        const key = String(err.path[0]);
        if (!errors[key]) errors[key] = err.message;
      });
      setFieldErrors(errors);
      // Scroll vers la première erreur pour aider l'utilisateur
      const firstErrorKey = Object.keys(errors)[0];
      if (firstErrorKey) {
        setTimeout(() => {
          const el = document.getElementById(firstErrorKey);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.focus();
        }, 50);
      }
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      Object.entries(fields).forEach(([key, val]) => formData.append(key, val));
      if (kbisFile) formData.append("kbis", kbisFile);
      if (docFile) formData.append("document", docFile);

      const res = await fetch("/api/auth/register", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        setGlobalError(json.error ?? t("kbisRequired"));
        return;
      }
      setAutoApproved(json.autoApproved === true);
      setSuccessMessage(json.message);
    } catch {
      setGlobalError(t("kbisRequired"));
    } finally {
      setLoading(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // ÉCRAN DE SUCCÈS
  // ───────────────────────────────────────────────────────────────────────
  if (successMessage) {
    return (
      <div className="w-full max-w-xl">
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
          <Link href={autoApproved ? "/connexion" : "/"} className="btn-primary justify-center">
            {autoApproved ? "Se connecter" : t("backHome")}
          </Link>
        </div>
      </div>
    );
  }

  const formattedCount = productCount
    ? new Intl.NumberFormat("fr-FR").format(productCount)
    : null;

  // ───────────────────────────────────────────────────────────────────────
  // FORMULAIRE
  // ───────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-3xl">
      {/* ── Hero ── */}
      <header className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-[11px] font-body font-semibold px-3.5 py-1.5 rounded-full mb-5 uppercase tracking-[0.12em]">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" />
          </svg>
          Espace professionnel B2B
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary tracking-tight leading-tight">
          {t("title")}
        </h1>
        <p className="mt-3 font-body text-text-muted max-w-md mx-auto leading-relaxed">
          {t("subtitle")}
        </p>
      </header>

      {/* ── Trust signals (3 stats) ── */}
      <div className={`grid ${formattedCount ? "grid-cols-3" : "grid-cols-2"} gap-3 mb-6`}>
        {formattedCount && (
          <TrustStat
            value={formattedCount}
            label="références en ligne"
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            }
          />
        )}
        <TrustStat
          value={todayHoursLabel ?? "9h — 22h"}
          label={todayHoursLabel === "Fermé" ? "aujourd'hui" : "validation rapide"}
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          }
        />
        <TrustStat
          value="Prix HT"
          label="tarifs grossiste"
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.281m5.94 2.28l-2.28 5.941" />
          }
        />
      </div>

      {/* ── Disponibilité staff ── */}
      <div className="mb-6">
        <StaffAvailability schedule={schedule} />
      </div>

      {/* ── Bandeau Code d'invitation (collapsible) ── */}
      <InviteCodeBanner
        open={inviteOpen}
        onToggle={() => setInviteOpen((v) => !v)}
        code={inviteCode}
        status={inviteStatus}
        error={inviteError}
        onCodeChange={(v) => {
          setInviteCode(v.toUpperCase());
          if (inviteStatus !== "idle") {
            setInviteStatus("idle");
            setInviteError("");
          }
        }}
        onValidate={() => validateInviteCode(inviteCode)}
        onClear={() => {
          setInviteCode("");
          setInviteStatus("idle");
          setInviteError("");
          document.cookie = "bj_access_code=; max-age=0; path=/";
        }}
      />

      {/* ── Erreur globale ── */}
      {globalError && (
        <div role="alert" className="bg-red-50 border border-red-200 text-error px-4 py-3.5 text-sm font-body flex items-start gap-2.5 mb-6 rounded-xl">
          <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>{globalError}</span>
        </div>
      )}

      {/* ── Formulaire ── */}
      <form onSubmit={handleSubmit} noValidate encType="multipart/form-data" className="space-y-5">

        {/* ── Section 1 : Vous ── */}
        <SectionCard
          step={1}
          title="Vous"
          description="Vos coordonnées personnelles. Elles ne seront jamais visibles publiquement."
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0v.75H4.5v-.75z" />
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField id="firstName" label={t("firstName")} type="text"
              value={fields.firstName} error={fieldErrors.firstName}
              placeholder="Marie" autoComplete="given-name" optional
              onChange={(v) => handleChange("firstName", v)} />
            <FormField id="lastName" label={t("lastName")} type="text"
              value={fields.lastName} error={fieldErrors.lastName}
              placeholder="Dupont" autoComplete="family-name" optional
              onChange={(v) => handleChange("lastName", v)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField id="email" label={t("email")} type="email"
              value={fields.email} error={fieldErrors.email}
              placeholder="contact@societe.fr" autoComplete="email"
              onChange={(v) => handleChange("email", v)} />
            <FormField id="phone" label={t("phone")} type="tel"
              value={fields.phone} error={fieldErrors.phone}
              placeholder="0612345678" autoComplete="tel"
              onChange={(v) => handleChange("phone", v)} />
          </div>
        </SectionCard>

        {/* ── Section 2 : Votre société ── */}
        <SectionCard
          step={2}
          title="Votre société"
          description="Informations légales de votre entreprise — vérifiées par notre équipe."
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
          }
        >
          <FormField id="company" label={t("company")} type="text"
            value={fields.company} error={fieldErrors.company}
            placeholder="Mon Entreprise SARL" autoComplete="organization"
            onChange={(v) => handleChange("company", v)} />
          <FormField id="siret" label={t("siret")} type="text"
            value={fields.siret} error={fieldErrors.siret}
            placeholder="12345678901234" maxLength={14} mono
            onChange={(v) => handleChange("siret", v.replace(/\D/g, ""))} />

          {/* TVA */}
          <div>
            <FieldLabel id="vatNumber" optional>{t("vatNumber")}</FieldLabel>
            <input
              id="vatNumber" type="text" value={fields.vatNumber}
              onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
              placeholder="FR12345678901" maxLength={20}
              className={`field-input font-mono tracking-wide ${fieldErrors.vatNumber ? "border-error" : ""}`}
            />
            <p className="text-xs text-text-muted mt-1.5 font-body">{t("vatNumberHint")}</p>
            {fieldErrors.vatNumber && <p className="text-xs text-error mt-1">{fieldErrors.vatNumber}</p>}

            {showEuVatNotice && (
              <div className="mt-4 flex items-start gap-3 bg-[#FFFBEB] border border-[#FCD34D] rounded-xl p-4">
                <div className="w-8 h-8 bg-[#FCD34D]/40 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#B45309]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v3.75m0 3.75h.008v.008H12v-.008zm9-3.75a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="text-sm font-body text-[#7C2D12] leading-relaxed">
                  <p className="font-semibold mb-1.5">Pays UE — recommandation TVA</p>
                  <p className="text-xs leading-relaxed">
                    Si votre société est assujettie à la TVA, renseignez ci-dessus votre <strong>numéro de TVA intracommunautaire valide</strong>.
                    Notre équipe le vérifiera à l&apos;examen de votre dossier.
                    À défaut de validation, <strong>20 % de TVA française seront appliqués automatiquement</strong> à vos commandes.
                  </p>
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* ── Section 3 : Adresse ── */}
        <SectionCard
          step={3}
          title="Adresse de la société"
          description="Le siège social. Cette adresse détermine la TVA appliquée à vos commandes."
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          }
        >
          <FormField
            id="addressStreet" label="Adresse" type="text"
            value={fields.addressStreet} error={fieldErrors.addressStreet}
            placeholder="12 rue des Lilas" autoComplete="street-address"
            onChange={(v) => handleChange("addressStreet", v)}
          />
          <FormField
            id="addressComplement" label="Complément d'adresse" type="text"
            value={fields.addressComplement} error={fieldErrors.addressComplement}
            placeholder="Bâtiment B, 3e étage" autoComplete="address-line2"
            optional
            onChange={(v) => handleChange("addressComplement", v)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField
              id="addressZip" label="Code postal" type="text"
              value={fields.addressZip} error={fieldErrors.addressZip}
              placeholder="75011" autoComplete="postal-code"
              onChange={(v) => handleChange("addressZip", v)}
            />
            <div className="sm:col-span-2">
              <FormField
                id="addressCity" label="Ville" type="text"
                value={fields.addressCity} error={fieldErrors.addressCity}
                placeholder="Paris" autoComplete="address-level2"
                onChange={(v) => handleChange("addressCity", v)}
              />
            </div>
          </div>
          <div>
            <FieldLabel id="addressCountry">Pays</FieldLabel>
            <CustomSelect
              id="addressCountry"
              value={fields.addressCountry}
              onChange={(v) => handleChange("addressCountry", v)}
              options={countryOptions}
              searchable
              placeholder="Sélectionnez un pays"
              aria-label="Pays de la société"
            />
            {fieldErrors.addressCountry && (
              <p className="text-xs text-error mt-1 font-body">{fieldErrors.addressCountry}</p>
            )}
          </div>
        </SectionCard>

        {/* ── Section 4 : Justificatifs ── */}
        <SectionCard
          step={4}
          title="Justificatifs"
          description="Aidez-nous à valider rapidement votre dossier — tous les fichiers sont optionnels."
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          }
        >
          <UploadField
            id="kbis"
            label={t("kbis")}
            description={t("kbisFormats")}
            file={kbisFile}
            error={kbisError}
            inputRef={fileInputRef}
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleKbisChange}
            onClear={() => { setKbisFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
          />
          <UploadField
            id="document"
            label="Document complémentaire"
            description="PDF, JPG, PNG, DOC, DOCX — max 10 Mo. Licence, attestation, etc."
            file={docFile}
            error={docError}
            inputRef={docInputRef}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            onChange={handleDocChange}
            onClear={() => { setDocFile(null); if (docInputRef.current) docInputRef.current.value = ""; }}
          />

          {/* Message libre */}
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
              <p className="text-xs text-text-muted font-body">
                Présentez votre activité, vos volumes habituels…
              </p>
              <span className="text-xs text-text-muted font-body tabular-nums">
                {fields.registrationMessage.length}/2000
              </span>
            </div>
            {fieldErrors.registrationMessage && (
              <p className="text-xs text-error mt-1">{fieldErrors.registrationMessage}</p>
            )}
          </div>
        </SectionCard>

        {/* ── Section 5 : Sécurité ── */}
        <SectionCard
          step={5}
          title="Mot de passe"
          description="Au moins 8 caractères, une majuscule et un chiffre."
          icon={
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          }
        >
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
        </SectionCard>

        {/* ── CTA + Réassurance ── */}
        <div className="bg-bg-primary rounded-2xl border border-border p-6 md:p-7 shadow-card">
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

          {/* Réassurance + login link */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs font-body text-text-muted">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
              <span>Vos données sont chiffrées. Aucun spam — RGPD compliant.</span>
            </div>
            <p>
              {t("hasAccount")}{" "}
              <Link href="/connexion" className="text-text-primary font-medium hover:underline transition-colors">
                {t("loginLink")}
              </Link>
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers visuels
// ─────────────────────────────────────────────

function TrustStat({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="bg-bg-primary rounded-xl border border-border p-3.5 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
        <p className="font-heading text-base font-bold text-text-primary leading-none">{value}</p>
      </div>
      <p className="text-[11px] text-text-muted font-body">{label}</p>
    </div>
  );
}

function SectionCard({
  step,
  title,
  description,
  icon,
  children,
}: {
  step: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-bg-primary rounded-2xl border border-border shadow-card overflow-hidden">
      <header className="flex items-start gap-4 px-6 pt-6 pb-5 border-b border-border-light">
        <div className="w-10 h-10 rounded-xl bg-bg-secondary flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] font-body font-semibold text-text-muted tabular-nums">
              {String(step).padStart(2, "0")}
            </span>
            <h2 className="font-heading text-base font-semibold text-text-primary tracking-tight">
              {title}
            </h2>
          </div>
          <p className="text-xs text-text-muted font-body mt-0.5 leading-relaxed">
            {description}
          </p>
        </div>
      </header>
      <div className="p-6 space-y-4">
        {children}
      </div>
    </section>
  );
}

function FieldLabel({ id, children, optional }: { id: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-baseline justify-between text-sm font-body font-medium text-text-primary mb-1.5">
      <span>{children}</span>
      {optional ? (
        <span className="text-xs text-text-muted font-normal normal-case">Optionnel</span>
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
  id, label, description, file, error, inputRef, accept, onChange, onClear,
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
}) {
  return (
    <div>
      <FieldLabel id={id} optional>{label}</FieldLabel>
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
              <p className="text-sm font-body font-medium text-text-primary">Cliquez pour téléverser</p>
              <p className="text-xs text-text-muted font-body mt-0.5">{description}</p>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-error mt-1.5 font-body" role="alert">{error}</p>}
    </div>
  );
}

function InviteCodeBanner({
  open, onToggle, code, status, error, onCodeChange, onValidate, onClear,
}: {
  open: boolean;
  onToggle: () => void;
  code: string;
  status: "idle" | "validating" | "valid" | "error";
  error: string;
  onCodeChange: (v: string) => void;
  onValidate: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`bg-bg-primary rounded-2xl border transition-all mb-6 overflow-hidden ${
      status === "valid" ? "border-success/40 shadow-[0_0_0_3px_rgba(34,197,94,0.08)]" : "border-border"
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-bg-secondary/50 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            status === "valid" ? "bg-success/15" : "bg-bg-secondary"
          }`}>
            <svg className={`w-4.5 h-4.5 ${status === "valid" ? "text-success" : "text-text-muted"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-body font-medium text-text-primary">
              {status === "valid" ? "Code d'invitation validé" : "J'ai un code d'invitation"}
            </p>
            <p className="text-xs text-text-muted font-body">
              {status === "valid"
                ? "Activation immédiate après inscription, sans vérification."
                : "Optionnel — accélère votre validation."}
            </p>
          </div>
        </div>
        <svg className={`w-4 h-4 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-border-light pt-4">
          <div className="flex gap-2">
            <input
              id="inviteCode"
              type="text"
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder="Entrez votre code"
              disabled={status === "valid"}
              className={`field-input flex-1 text-sm uppercase tracking-[0.15em] font-mono ${
                status === "valid" ? "border-success bg-[#F0FDF4]" : status === "error" ? "border-error" : ""
              }`}
            />
            {status === "valid" ? (
              <button
                type="button"
                onClick={onClear}
                className="px-3 py-2 text-sm font-body text-text-muted hover:text-error border border-border rounded-lg transition-colors"
                aria-label="Retirer le code"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={onValidate}
                disabled={!code.trim() || status === "validating"}
                className="btn-primary px-5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === "validating" ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : "Valider"}
              </button>
            )}
          </div>

          {status === "error" && error && (
            <p className="mt-2 text-xs text-error font-body">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8 caractères", ok: password.length >= 8 },
    { label: "1 majuscule", ok: /[A-Z]/.test(password) },
    { label: "1 chiffre", ok: /[0-9]/.test(password) },
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
