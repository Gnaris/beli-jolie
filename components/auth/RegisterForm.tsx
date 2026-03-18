"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { registerSchema } from "@/lib/validations/auth";

type FieldErrors = Partial<Record<string, string>>;

export default function RegisterForm() {
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
  const [fieldErrors, setFieldErrors]     = useState<FieldErrors>({});
  const [globalError, setGlobalError]     = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading]             = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const [autoApproved, setAutoApproved]   = useState(false);
  const fileInputRef                      = useRef<HTMLInputElement>(null);

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
          <h2 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary mb-3 tracking-tight">
            {t("successTitle")}
          </h2>
          <p className="font-[family-name:var(--font-roboto)] text-text-muted text-sm leading-relaxed mb-8">
            {successMessage}
          </p>
          <Link href={autoApproved ? "/connexion" : "/"} className="btn-primary justify-center">
            {autoApproved ? "Se connecter" : t("backHome")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-text-primary tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1.5 font-[family-name:var(--font-roboto)] text-sm text-text-muted">
          {t("subtitle")}
        </p>
      </div>

      <div className="bg-bg-primary rounded-xl border border-border p-6 md:p-8 shadow-card">
        <form onSubmit={handleSubmit} noValidate encType="multipart/form-data">

          {globalError && (
            <div role="alert" className="bg-red-50 border border-red-200 text-error px-4 py-3 text-sm font-[family-name:var(--font-roboto)] flex items-start gap-2.5 mb-6 rounded-lg">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>{globalError}</span>
            </div>
          )}

          <div className="space-y-6">

            {/* Section Identité */}
            <div>
              <p className="text-[11px] font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionIdentity")}
              </p>
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField id="firstName" label={t("firstName")} type="text"
                    value={fields.firstName} error={fieldErrors.firstName}
                    placeholder="Marie" autoComplete="given-name"
                    onChange={(v) => handleChange("firstName", v)} />
                  <FormField id="lastName" label={t("lastName")} type="text"
                    value={fields.lastName} error={fieldErrors.lastName}
                    placeholder="Dupont" autoComplete="family-name"
                    onChange={(v) => handleChange("lastName", v)} />
                </div>
                <FormField id="company" label={t("company")} type="text"
                  value={fields.company} error={fieldErrors.company}
                  placeholder="Ma Bijouterie SARL" autoComplete="organization"
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
            <div className="border-t border-border pt-6">
              <p className="text-[11px] font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionLegal")}
              </p>
              <div className="space-y-4">
                <FormField id="siret" label={t("siret")} type="text"
                  value={fields.siret} error={fieldErrors.siret}
                  placeholder="12345678901234" maxLength={14}
                  onChange={(v) => handleChange("siret", v.replace(/\D/g, ""))} />

                <div>
                  <label htmlFor="vatNumber" className="block text-[13px] font-[family-name:var(--font-roboto)] font-medium text-text-secondary mb-1.5">
                    {t("vatNumber")}{" "}
                    <span className="text-text-muted font-normal">{t("vatNumberOptional")}</span>
                  </label>
                  <input
                    id="vatNumber" type="text" value={fields.vatNumber}
                    onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
                    placeholder="FR12345678901" maxLength={20}
                    className={`field-input ${fieldErrors.vatNumber ? "border-error" : ""}`}
                  />
                  <p className="text-xs text-text-muted mt-1 font-[family-name:var(--font-roboto)]">
                    {t("vatNumberHint")}
                  </p>
                  {fieldErrors.vatNumber && <p className="text-xs text-error mt-1">{fieldErrors.vatNumber}</p>}
                </div>

                {/* Kbis upload */}
                <div>
                  <label htmlFor="kbis" className="block text-[13px] font-[family-name:var(--font-roboto)] font-medium text-text-secondary mb-1.5">
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
                        <span className="text-sm font-[family-name:var(--font-roboto)] font-medium">{kbisFile.name}</span>
                      </div>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-text-muted mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        <p className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary">{t("kbisClick")}</p>
                        <p className="text-xs text-text-muted mt-1">{t("kbisFormats")}</p>
                      </>
                    )}
                  </div>
                  {kbisError && <p className="text-xs text-error mt-1 font-[family-name:var(--font-roboto)]" role="alert">{kbisError}</p>}
                </div>
              </div>
            </div>

            {/* Section Message */}
            <div className="border-t border-border pt-6">
              <p className="text-[11px] font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionMessage")}
              </p>
              <div>
                <label htmlFor="registrationMessage" className="block text-[13px] font-[family-name:var(--font-roboto)] font-medium text-text-secondary mb-1.5">
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
                <p className="text-xs text-text-muted mt-1 font-[family-name:var(--font-roboto)]">
                  {fields.registrationMessage.length}/2000
                </p>
                {fieldErrors.registrationMessage && (
                  <p className="text-xs text-error mt-1">{fieldErrors.registrationMessage}</p>
                )}
              </div>
            </div>

            {/* Section Sécurité */}
            <div className="border-t border-border pt-6">
              <p className="text-[11px] font-[family-name:var(--font-roboto)] font-semibold text-text-muted uppercase tracking-widest mb-3">
                {t("sectionSecurity")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className="block text-[13px] font-[family-name:var(--font-roboto)] font-medium text-text-secondary mb-1.5">
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
                  <p className="text-xs text-text-muted mt-1 font-[family-name:var(--font-roboto)]">{t("passwordHint")}</p>
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

        <p className="mt-6 text-center text-sm font-[family-name:var(--font-roboto)] text-text-muted">
          {t("hasAccount")}{" "}
          <Link href="/connexion" className="text-text-primary font-medium hover:underline transition-colors">
            {t("loginLink")}
          </Link>
        </p>
      </div>
    </div>
  );
}

function FormField({ id, label, type, value, error, placeholder, autoComplete, maxLength, onChange }: {
  id: string; label: string; type: string; value: string;
  error?: string; placeholder?: string; autoComplete?: string;
  maxLength?: number; onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-[family-name:var(--font-roboto)] font-medium text-text-secondary mb-1.5">
        {label} <span className="text-text-muted">*</span>
      </label>
      <input
        id={id} type={type} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        maxLength={maxLength} required
        className={`field-input ${error ? "border-error" : ""}`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-error mt-1 font-[family-name:var(--font-roboto)]">{error}</p>}
    </div>
  );
}
