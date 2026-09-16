"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateProfile } from "@/app/actions/client/profile";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { COUNTRIES } from "@/lib/vat";

interface AccountEditorProps {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    phone: string;
    siret: string | null;
    vatNumber: string | null;
    addressStreet: string | null;
    addressComplement: string | null;
    addressZip: string | null;
    addressCity: string | null;
    addressCountry: string | null;
  };
}

export default function AccountEditor({ user }: AccountEditorProps) {
  const t = useTranslations("account");
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [company, setCompany] = useState(user.company);
  const [phone, setPhone] = useState(user.phone);
  const [siret, setSiret] = useState(user.siret ?? "");
  const [vatNumber, setVatNumber] = useState(user.vatNumber ?? "");
  const [addressStreet, setAddressStreet] = useState(user.addressStreet ?? "");
  const [addressComplement, setAddressComplement] = useState(user.addressComplement ?? "");
  const [addressZip, setAddressZip] = useState(user.addressZip ?? "");
  const [addressCity, setAddressCity] = useState(user.addressCity ?? "");
  const [addressCountry, setAddressCountry] = useState(user.addressCountry ?? "");

  const countryOptions: SelectOption[] = useMemo(
    () => COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
    [],
  );

  const vatChanged = (vatNumber.trim().toUpperCase() || null) !== (user.vatNumber?.toUpperCase() || null);

  function handleSave() {
    if (!firstName.trim() || !lastName.trim() || !company.trim() || !phone.trim()) {
      setError(t("fieldsRequired"));
      return;
    }
    setError("");
    showLoading();
    startTransition(async () => {
      try {
        const res = await updateProfile({
          firstName,
          lastName,
          company,
          phone,
          siret,
          vatNumber,
          addressStreet,
          addressComplement,
          addressZip,
          addressCity,
          addressCountry,
        });
        if (!res.success) {
          setError(res.error);
        } else {
          setEditing(false);
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        }
      } catch {
        setError(t("updateError"));
      } finally {
        hideLoading();
      }
    });
  }

  function handleCancel() {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setCompany(user.company);
    setPhone(user.phone);
    setSiret(user.siret ?? "");
    setVatNumber(user.vatNumber ?? "");
    setAddressStreet(user.addressStreet ?? "");
    setAddressComplement(user.addressComplement ?? "");
    setAddressZip(user.addressZip ?? "");
    setAddressCity(user.addressCity ?? "");
    setAddressCountry(user.addressCountry ?? "");
    setEditing(false);
    setError("");
  }

  const readOnlyAddress = [
    user.addressStreet,
    user.addressComplement,
    [user.addressZip, user.addressCity].filter(Boolean).join(" "),
    COUNTRIES.find((c) => c.code === user.addressCountry)?.name ?? user.addressCountry,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="bg-bg-primary rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          {t("profileSection")}
        </h2>
        <div className="flex items-center gap-2">
          {success && (
            <span className="text-xs text-emerald-600 font-body flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {t("saved")}
            </span>
          )}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-body font-medium text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
              {t("edit")}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="text-xs font-body font-medium bg-bg-dark text-text-inverse px-3 py-1.5 rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isPending ? "..." : t("save")}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-xs font-body text-text-secondary hover:text-text-primary transition-colors"
              >
                {t("cancel")}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600 font-body">{error}</p>
        </div>
      )}

      {editing && vatChanged && vatNumber.trim() !== "" && (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-100">
          <p className="text-xs text-amber-800 font-body">{t("vatResetNotice")}</p>
        </div>
      )}

      <div className="divide-y divide-border-light">
        {/* Email — non éditable côté client */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
          <span className="text-xs font-body font-medium text-text-muted uppercase tracking-wider w-32 shrink-0">
            {t("email")}
          </span>
          <div className="flex-1">
            <span className="text-sm text-text-primary font-body">{user.email}</span>
            {editing && (
              <p className="text-[11px] text-text-muted mt-0.5 font-body italic">
                {t("emailNotEditable")}
              </p>
            )}
          </div>
        </div>

        {/* Contact */}
        <ProfileRow label={t("firstName")} value={firstName} onChange={setFirstName} editing={editing} required />
        <ProfileRow label={t("lastName")} value={lastName} onChange={setLastName} editing={editing} required />
        <ProfileRow label={t("company")} value={company} onChange={setCompany} editing={editing} required />
        <ProfileRow label={t("phone")} value={phone} onChange={setPhone} editing={editing} required />

        {/* Entreprise */}
        <ProfileRow label={t("siret")} value={siret} onChange={setSiret} editing={editing} mono />
        <ProfileRow label={t("vatNumber")} value={vatNumber} onChange={setVatNumber} editing={editing} mono />

        {/* Adresse — 1 ligne read-only, 5 champs en édition */}
        {!editing ? (
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6 px-5 py-3">
            <span className="text-xs font-body font-medium text-text-muted uppercase tracking-wider w-32 shrink-0">
              {t("address")}
            </span>
            <span className="text-sm text-text-primary font-body">
              {readOnlyAddress || <span className="text-text-muted italic">{t("notProvided")}</span>}
            </span>
          </div>
        ) : (
          <>
            <ProfileRow label={t("addressStreet")} value={addressStreet} onChange={setAddressStreet} editing />
            <ProfileRow label={t("addressComplement")} value={addressComplement} onChange={setAddressComplement} editing />
            <ProfileRow label={t("addressZip")} value={addressZip} onChange={setAddressZip} editing />
            <ProfileRow label={t("addressCity")} value={addressCity} onChange={setAddressCity} editing />
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
              <span className="text-xs font-body font-medium text-text-muted uppercase tracking-wider w-32 shrink-0">
                {t("addressCountry")}
              </span>
              <div className="flex-1 min-w-0">
                <CustomSelect
                  value={addressCountry}
                  onChange={setAddressCountry}
                  options={countryOptions}
                  placeholder={t("selectCountry")}
                  searchable
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileRow({
  label,
  value,
  onChange,
  editing,
  required = false,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
      <span className="text-xs font-body font-medium text-text-muted uppercase tracking-wider w-32 shrink-0">
        {label}
      </span>
      {editing ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={`flex-1 min-w-0 text-sm text-text-primary ${mono ? "font-mono" : "font-body"} border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:border-bg-dark transition-colors`}
          placeholder={label}
        />
      ) : (
        <span className={`text-sm text-text-primary ${mono ? "font-mono" : "font-body"}`}>
          {value || <span className="text-text-muted italic font-body">—</span>}
        </span>
      )}
    </div>
  );
}
