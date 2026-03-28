"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { registerSchema } from "@/lib/validations/auth";
import StaffAvailability from "@/components/auth/StaffAvailability";

type FieldErrors = Partial<Record<string, string>>;

export default function RegisterForm({ productCount }: { productCount?: number }) {
  const t = useTranslations("auth.register");

  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
    siret: "",
    vatNumber: "",
    password: "",
    confirmPassword: "",
    registrationMessage: "",
  });

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
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const docInputRef                           = useRef<HTMLInputElement>(null);

  function applyPrefill(prefill: Record<string, string>) {
    setFields((prev) => {
      const updated = { ...prev };
      if (prefill.firstName && !prev.firstName) updated.firstName = prefill.firstName;
      if (prefill.lastName && !prev.lastName)   updated.lastName  = prefill.lastName;
      if (prefill.company && !prev.company)     updated.company   = prefill.company;
      if (prefill.email && !prev.email)         updated.email     = prefill.email;
      if (prefill.phone && !prev.phone)         updated.phone     = prefill.phone;
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
      // Récupérer les données prefill associées au code
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

  if (successMessage) {
    return (
      <div className="w-full max-w-lg text-center">
        <div className="bg-bg-primary rounded-xl border border-border p-10 shadow-card">
          <div className="w-14 h-14 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-heading text-2xl font-semibold text-text-primary mb-3 tracking-tight">
            {t("successTitle")}
          </h2>
          <p className="font-body text-text-muted text-sm leading-relaxed mb-8">
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

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-xs font-body font-semibold px-4 py-1.5 rounded-full mb-4 uppercase tracking-wider">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
          Espace B2B
        </div>
        <h1 className="font-heading text-2xl font-bold text-text-primary tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1.5 font-body text-sm text-text-muted">
          {t("subtitle")}
        </p>
      </div>

      {/* ── Stats B2B ── */}
      <div className={`grid ${formattedCount ? "grid-cols-3" : "grid-cols-2"} gap-3 mb-6`}>
        {formattedCount && (
          <div className="bg-bg-primary rounded-xl border border-border p-4 text-center">
            <p className="font-heading text-xl font-bold text-text-primary">{formattedCount}</p>
            <p className="text-xs text-text-muted font-body mt-0.5">références en ligne</p>
          </div>
        )}
        <div className="bg-bg-primary rounded-xl border border-border p-4 text-center">
          <p className="font-heading text-xl font-bold text-text-primary">9h — 22h</p>
          <p className="text-xs text-text-muted font-body mt-0.5">validation rapide</p>
        </div>
        <div className="bg-bg-primary rounded-xl border border-border p-4 text-center">
          <p className="font-heading text-xl font-bold text-text-primary">Prix HT</p>
          <p className="text-xs text-text-muted font-body mt-0.5">tarifs grossiste</p>
        </div>
      </div>

      {/* ── Disponibilité staff ── */}
      <div className="mb-6">
        <StaffAvailability />
      </div>

      {/* ── Code d'invitation ── */}
      <div className="mb-6">
        <div className="bg-bg-primary rounded-xl border border-border p-4">
          <label htmlFor="inviteCode" className="flex items-center gap-2 text-sm font-body font-medium text-text-primary mb-2">
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
            J&apos;ai un code d&apos;invitation
          </label>
          <div className="flex gap-2">
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={(e) => {
                setInviteCode(e.target.value.toUpperCase());
                if (inviteStatus !== "idle") {
                  setInviteStatus("idle");
                  setInviteError("");
                }
              }}
              placeholder="Entrez votre code"
              disabled={inviteStatus === "valid"}
              className={`field-input flex-1 text-sm uppercase tracking-wider ${
                inviteStatus === "valid" ? "border-success bg-[#F0FDF4]" : inviteStatus === "error" ? "border-error" : ""
              }`}
            />
            {inviteStatus === "valid" ? (
              <button
                type="button"
                onClick={() => {
                  setInviteCode("");
                  setInviteStatus("idle");
                  setInviteError("");
                  document.cookie = "bj_access_code=; max-age=0; path=/";
                }}
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
                onClick={() => validateInviteCode(inviteCode)}
                disabled={!inviteCode.trim() || inviteStatus === "validating"}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {inviteStatus === "validating" ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : "Valider"}
              </button>
            )}
          </div>

          {/* Message de validation */}
          {inviteStatus === "valid" && (
            <div className="mt-3 flex items-start gap-2 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg p-3">
              <svg className="w-4 h-4 text-success flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-xs font-body text-text-secondary leading-relaxed">
                Code d&apos;accès validé — votre compte sera activé immédiatement après inscription, sans vérification.
              </p>
            </div>
          )}

          {/* Message d'erreur */}
          {inviteStatus === "error" && inviteError && (
            <p className="mt-2 text-xs text-error font-body">{inviteError}</p>
          )}
        </div>
      </div>

      <div className="bg-bg-primary rounded-xl border border-border p-6 md:p-8 shadow-lg">
        <form onSubmit={handleSubmit} noValidate encType="multipart/form-data">

          {globalError && (
            <div role="alert" className="bg-red-50 border border-red-200 text-error px-4 py-3 text-sm font-body flex items-start gap-2.5 mb-6 rounded-lg">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>{globalError}</span>
            </div>
          )}

          <div className="space-y-6">

            {/* Section Identité */}
            <div>
              <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionIdentity")}
              </p>
              <div className="space-y-4">
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
                <FormField id="company" label={t("company")} type="text"
                  value={fields.company} error={fieldErrors.company}
                  placeholder="Mon Entreprise SARL" autoComplete="organization"
                  onChange={(v) => handleChange("company", v)} />
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
              </div>
            </div>

            {/* Section Informations légales */}
            <div className="pt-6">
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-6" />
              <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionLegal")}
              </p>
              <div className="space-y-4">
                <FormField id="siret" label={t("siret")} type="text"
                  value={fields.siret} error={fieldErrors.siret}
                  placeholder="12345678901234" maxLength={14}
                  onChange={(v) => handleChange("siret", v.replace(/\D/g, ""))} />

                <div>
                  <label htmlFor="vatNumber" className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
                    {t("vatNumber")}{" "}
                    <span className="text-text-muted font-normal">{t("vatNumberOptional")}</span>
                  </label>
                  <input
                    id="vatNumber" type="text" value={fields.vatNumber}
                    onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
                    placeholder="FR12345678901" maxLength={20}
                    className={`field-input ${fieldErrors.vatNumber ? "border-error" : ""}`}
                  />
                  <p className="text-xs text-text-muted mt-1 font-body">
                    {t("vatNumberHint")}
                  </p>
                  {fieldErrors.vatNumber && <p className="text-xs text-error mt-1">{fieldErrors.vatNumber}</p>}
                </div>

                {/* Kbis upload */}
                <div>
                  <label htmlFor="kbis" className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
                    {t("kbis")}{" "}
                    <span className="text-text-muted font-normal">{t("vatNumberOptional")}</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      kbisError ? "border-error bg-red-50" : kbisFile ? "border-text-primary bg-bg-secondary" : "border-border bg-bg-secondary hover:border-text-secondary"
                    } p-5 text-center`}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                    role="button" tabIndex={0} aria-label={t("kbisClick")}
                  >
                    <input ref={fileInputRef} id="kbis" type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp"
                      onChange={handleKbisChange} className="sr-only" />
                    {kbisFile ? (
                      <div className="flex items-center justify-center gap-2 text-text-secondary">
                        <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm font-body font-medium">{kbisFile.name}</span>
                      </div>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-text-muted mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        <p className="text-sm font-body text-text-secondary">{t("kbisClick")}</p>
                        <p className="text-xs text-text-muted mt-1">{t("kbisFormats")}</p>
                      </>
                    )}
                  </div>
                  {kbisError && <p className="text-xs text-error mt-1 font-body" role="alert">{kbisError}</p>}
                </div>

                {/* Document libre */}
                <div>
                  <label htmlFor="document" className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
                    Document complémentaire{" "}
                    <span className="text-text-muted font-normal">{t("vatNumberOptional")}</span>
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      docError ? "border-error bg-red-50" : docFile ? "border-text-primary bg-bg-secondary" : "border-border bg-bg-secondary hover:border-text-secondary"
                    } p-5 text-center`}
                    onClick={() => docInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && docInputRef.current?.click()}
                    role="button" tabIndex={0} aria-label="Cliquez pour envoyer un document"
                  >
                    <input ref={docInputRef} id="document" type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                      onChange={handleDocChange} className="sr-only" />
                    {docFile ? (
                      <div className="flex items-center justify-center gap-2 text-text-secondary">
                        <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm font-body font-medium">{docFile.name}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setDocFile(null); if (docInputRef.current) docInputRef.current.value = ""; }}
                          className="ml-2 text-text-muted hover:text-error transition-colors"
                          aria-label="Supprimer le document"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-text-muted mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <p className="text-sm font-body text-text-secondary">Cliquez pour envoyer un document</p>
                        <p className="text-xs text-text-muted mt-1">PDF, JPG, PNG, DOC, DOCX — max 10 Mo</p>
                      </>
                    )}
                  </div>
                  {docError && <p className="text-xs text-error mt-1 font-body" role="alert">{docError}</p>}
                  <p className="text-xs text-text-muted mt-1 font-body">
                    Tout document utile à votre dossier (licence, attestation, etc.)
                  </p>
                </div>
              </div>
            </div>

            {/* Section Message */}
            <div className="pt-6">
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-6" />
              <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionMessage")}
              </p>
              <div>
                <label htmlFor="registrationMessage" className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
                  {t("message")}{" "}
                  <span className="text-text-muted font-normal">{t("vatNumberOptional")}</span>
                </label>
                <textarea
                  id="registrationMessage"
                  value={fields.registrationMessage}
                  onChange={(e) => handleChange("registrationMessage", e.target.value)}
                  placeholder={t("messagePlaceholder")}
                  maxLength={2000}
                  rows={5}
                  className={`field-input resize-y min-h-[120px] ${fieldErrors.registrationMessage ? "border-error" : ""}`}
                />
                <p className="text-xs text-text-muted mt-1 font-body">
                  {fields.registrationMessage.length}/2000
                </p>
                {fieldErrors.registrationMessage && (
                  <p className="text-xs text-error mt-1">{fieldErrors.registrationMessage}</p>
                )}
              </div>
            </div>

            {/* Section Sécurité */}
            <div className="pt-6">
              <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-6" />
              <p className="text-[11px] font-body font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionSecurity")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
                    {t("password")} <span className="text-text-muted">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="password" type={showPassword ? "text" : "password"}
                      value={fields.password}
                      onChange={(e) => handleChange("password", e.target.value)}
                      placeholder="••••••••" autoComplete="new-password"
                      className={`field-input pr-12 ${fieldErrors.password ? "border-error" : ""}`}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={showPassword
                          ? "M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                          : "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z"} />
                      </svg>
                    </button>
                  </div>
                  {fieldErrors.password && <p className="text-xs text-error mt-1">{fieldErrors.password}</p>}
                  <p className="text-xs text-text-muted mt-1 font-body">{t("passwordHint")}</p>
                </div>
                <FormField id="confirmPassword" label={t("confirm")} type="password"
                  value={fields.confirmPassword} error={fieldErrors.confirmPassword}
                  placeholder="••••••••" autoComplete="new-password"
                  onChange={(v) => handleChange("confirmPassword", v)} />
              </div>
            </div>

            <button
              type="submit" disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t("loading")}
                </>
              ) : t("submit")}
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm font-body text-text-muted">
          {t("hasAccount")}{" "}
          <Link href="/connexion" className="text-text-primary font-medium hover:underline transition-colors">
            {t("loginLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}

function FormField({ id, label, type, value, error, placeholder, autoComplete, maxLength, optional, onChange }: {
  id: string; label: string; type: string; value: string;
  error?: string; placeholder?: string; autoComplete?: string;
  maxLength?: number; optional?: boolean; onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-body font-medium text-text-primary uppercase tracking-wide mb-1.5">
        {label} {optional
          ? <span className="text-text-muted font-normal">(optionnel)</span>
          : <span className="text-text-muted">*</span>}
      </label>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        maxLength={maxLength} required={!optional}
        className={`field-input ${error ? "border-error" : ""}`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-error mt-1 font-body">{error}</p>}
    </div>
  );
}
