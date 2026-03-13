"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { registerSchema } from "@/lib/validations/auth";

type FieldErrors = Partial<Record<string, string>>;

/**
 * Formulaire d'inscription BtoB — Beli & Jolie
 *
 * Champs : Prénom, Nom, Société, Email, Téléphone, SIRET, Mot de passe,
 *          Confirmation, Kbis (fichier PDF/image)
 *
 * Envoi en multipart/form-data vers POST /api/auth/register
 */
export default function RegisterForm() {
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
  });

  const [kbisFile, setKbisFile]           = useState<File | null>(null);
  const [kbisError, setKbisError]         = useState("");
  const [fieldErrors, setFieldErrors]     = useState<FieldErrors>({});
  const [globalError, setGlobalError]     = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading]             = useState(false);
  const [showPassword, setShowPassword]   = useState(false);
  const fileInputRef                      = useRef<HTMLInputElement>(null);

  /** Met à jour un champ et efface son erreur */
  function handleChange(field: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  /** Gestion de l'upload du Kbis */
  function handleKbisChange(e: React.ChangeEvent<HTMLInputElement>) {
    setKbisError("");
    const file = e.target.files?.[0] ?? null;

    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setKbisError("Format invalide. Accepté : PDF, JPG, PNG (max 5 Mo).");
      setKbisFile(null);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setKbisError("Le fichier dépasse la limite de 5 Mo.");
      setKbisFile(null);
      return;
    }

    setKbisFile(file);
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setGlobalError("");
    setFieldErrors({});

    // Validation Zod côté client
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

    if (!kbisFile) {
      setKbisError("Le fichier Kbis est obligatoire.");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      Object.entries(fields).forEach(([key, val]) => formData.append(key, val));
      formData.append("kbis", kbisFile);

      const res = await fetch("/api/auth/register", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setGlobalError(json.error ?? "Une erreur est survenue.");
        return;
      }

      setSuccessMessage(json.message);
    } catch {
      setGlobalError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  }

  /** Rendu du message de succès après inscription */
  if (successMessage) {
    return (
      <div className="w-full max-w-lg text-center">
        <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-10">
          <div className="w-16 h-16 bg-[#F1F5F9] rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-[#0F3460]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A] mb-3">
            Demande envoyée !
          </h2>
          <p className="font-[family-name:var(--font-roboto)] text-[#475569] text-sm leading-relaxed mb-8">
            {successMessage}
          </p>
          <Link href="/" className="btn-primary">
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      {/* Titre */}
      <div className="text-center mb-8">
        <h1 className="font-[family-name:var(--font-poppins)] text-3xl font-semibold text-[#0F172A]">
          Demande d&apos;accès Pro
        </h1>
        <p className="mt-2 font-[family-name:var(--font-roboto)] text-sm text-[#475569]">
          Remplissez le formulaire — notre équipe examinera votre dossier sous 48h.
        </p>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E2E8F0] p-6 md:p-8">
        <form onSubmit={handleSubmit} noValidate encType="multipart/form-data">

          {/* Erreur globale */}
          {globalError && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm font-[family-name:var(--font-roboto)] flex items-start gap-2 mb-6">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>{globalError}</span>
            </div>
          )}

          <div className="space-y-5">

            {/* ── Ligne 1 : Prénom + Nom ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="firstName" label="Prénom" type="text"
                value={fields.firstName} error={fieldErrors.firstName}
                placeholder="Marie" autoComplete="given-name"
                onChange={(v) => handleChange("firstName", v)}
              />
              <FormField
                id="lastName" label="Nom" type="text"
                value={fields.lastName} error={fieldErrors.lastName}
                placeholder="Dupont" autoComplete="family-name"
                onChange={(v) => handleChange("lastName", v)}
              />
            </div>

            {/* ── Société ── */}
            <FormField
              id="company" label="Société" type="text"
              value={fields.company} error={fieldErrors.company}
              placeholder="Ma Bijouterie SARL" autoComplete="organization"
              onChange={(v) => handleChange("company", v)}
            />

            {/* ── Ligne 2 : Email + Téléphone ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="email" label="Adresse e-mail" type="email"
                value={fields.email} error={fieldErrors.email}
                placeholder="contact@societe.fr" autoComplete="email"
                onChange={(v) => handleChange("email", v)}
              />
              <FormField
                id="phone" label="Téléphone" type="tel"
                value={fields.phone} error={fieldErrors.phone}
                placeholder="0612345678" autoComplete="tel"
                onChange={(v) => handleChange("phone", v)}
              />
            </div>

            {/* ── SIRET ── */}
            <FormField
              id="siret" label="Numéro SIRET" type="text"
              value={fields.siret} error={fieldErrors.siret}
              placeholder="12345678901234" maxLength={14}
              onChange={(v) => handleChange("siret", v.replace(/\D/g, ""))}
            />

            {/* ── N° TVA intracommunautaire (optionnel) ── */}
            <div>
              <label htmlFor="vatNumber" className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#1A1A1A] mb-1.5">
                N° TVA intracommunautaire{" "}
                <span className="text-[#999999] font-normal">(optionnel)</span>
              </label>
              <input
                id="vatNumber"
                type="text"
                value={fields.vatNumber}
                onChange={(e) => handleChange("vatNumber", e.target.value.toUpperCase().replace(/\s/g, ""))}
                placeholder="FR12345678901"
                maxLength={20}
                className={`w-full bg-white border ${fieldErrors.vatNumber ? "border-red-400" : "border-[#E5E5E5]"} rounded-lg px-4 py-3 text-sm font-[family-name:var(--font-roboto)] text-[#1A1A1A] placeholder:text-[#999999] focus:outline-none focus:border-[#1A1A1A] focus:shadow-[0_0_0_2px_rgba(26,26,26,0.08)] transition-all`}
              />
              <p className="text-xs text-[#999999] mt-1 font-[family-name:var(--font-roboto)]">
                Requis pour les entreprises UE hors France (exonération TVA par autoliquidation)
              </p>
              {fieldErrors.vatNumber && (
                <p className="text-xs text-red-600 mt-1 font-[family-name:var(--font-roboto)]">{fieldErrors.vatNumber}</p>
              )}
            </div>

            {/* ── Kbis (upload) ── */}
            <div>
              <label
                htmlFor="kbis"
                className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#0F172A] mb-1.5"
              >
                Extrait Kbis
                <span className="text-[#0F3460] ml-1">*</span>
              </label>
              <div
                className={`border-2 border-dashed ${kbisError ? "border-red-400" : kbisFile ? "border-[#0F3460]" : "border-[#E2E8F0]"} bg-white p-5 text-center cursor-pointer hover:border-[#0F3460] transition-colors`}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Sélectionner le fichier Kbis"
              >
                <input
                  ref={fileInputRef}
                  id="kbis"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={handleKbisChange}
                  className="sr-only"
                />
                {kbisFile ? (
                  <div className="flex items-center justify-center gap-2 text-[#0F3460]">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-[family-name:var(--font-roboto)] font-medium">
                      {kbisFile.name}
                    </span>
                  </div>
                ) : (
                  <>
                    <svg className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
                      Cliquez pour sélectionner votre Kbis
                    </p>
                    <p className="text-xs text-[#94A3B8] mt-1">PDF, JPG, PNG — max 5 Mo</p>
                  </>
                )}
              </div>
              {kbisError && (
                <p className="text-xs text-red-600 mt-1 font-[family-name:var(--font-roboto)]" role="alert">
                  {kbisError}
                </p>
              )}
            </div>

            {/* ── Séparateur ── */}
            <div className="border-t border-[#F1F5F9] pt-2">
              <p className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#475569] uppercase tracking-wider mb-4">
                Sécurité du compte
              </p>
            </div>

            {/* ── Mot de passe + confirmation ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="password" className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#0F172A] mb-1.5">
                  Mot de passe <span className="text-[#0F3460]">*</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={fields.password}
                    onChange={(e) => handleChange("password", e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className={`w-full bg-white border ${fieldErrors.password ? "border-red-400" : "border-[#E2E8F0]"} px-4 py-3 pr-12 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#0F3460] transition-colors`}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
                    aria-label={showPassword ? "Masquer" : "Afficher"}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={showPassword
                        ? "M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                        : "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z"} />
                    </svg>
                  </button>
                </div>
                {fieldErrors.password && <p className="text-xs text-red-600 mt-1 font-[family-name:var(--font-roboto)]">{fieldErrors.password}</p>}
                <p className="text-xs text-[#94A3B8] mt-1 font-[family-name:var(--font-roboto)]">8 caractères min, 1 majuscule, 1 chiffre</p>
              </div>

              <FormField
                id="confirmPassword" label="Confirmer le mot de passe" type="password"
                value={fields.confirmPassword} error={fieldErrors.confirmPassword}
                placeholder="••••••••" autoComplete="new-password"
                onChange={(v) => handleChange("confirmPassword", v)}
              />
            </div>

            {/* ── Bouton submit ── */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Envoi en cours...
                </>
              ) : (
                "Envoyer ma demande"
              )}
            </button>
          </div>
        </form>

        {/* Lien connexion */}
        <p className="mt-6 text-center text-sm font-[family-name:var(--font-roboto)] text-[#475569]">
          Déjà un compte ?{" "}
          <Link href="/connexion" className="text-[#0F3460] font-medium hover:text-[#0A2540] transition-colors">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Composant champ de formulaire réutilisable
// ─────────────────────────────────────────────
function FormField({
  id, label, type, value, error, placeholder, autoComplete, maxLength, onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-[family-name:var(--font-roboto)] font-medium text-[#0F172A] mb-1.5">
        {label} <span className="text-[#0F3460]">*</span>
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        required
        className={`w-full bg-white border ${error ? "border-red-400" : "border-[#E2E8F0]"} px-4 py-3 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#0F3460] transition-colors`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 mt-1 font-[family-name:var(--font-roboto)]">
          {error}
        </p>
      )}
    </div>
  );
}
