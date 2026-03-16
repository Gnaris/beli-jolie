"use client";

import { useState, useTransition } from "react";
import { updateProfile } from "@/app/actions/client/profile";

interface AccountEditorProps {
  user: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
    phone: string;
    siret: string;
    address: string | null;
    vatNumber: string | null;
  };
}

export default function AccountEditor({ user }: AccountEditorProps) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [company, setCompany] = useState(user.company);
  const [phone, setPhone] = useState(user.phone);
  const [address, setAddress] = useState(user.address ?? "");
  const [vatNumber, setVatNumber] = useState(user.vatNumber ?? "");

  function handleSave() {
    if (!firstName.trim() || !lastName.trim() || !company.trim() || !phone.trim()) {
      setError("Veuillez remplir tous les champs obligatoires.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await updateProfile({ firstName, lastName, company, phone, address, vatNumber });
        setEditing(false);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch {
        setError("Erreur lors de la mise a jour.");
      }
    });
  }

  function handleCancel() {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setCompany(user.company);
    setPhone(user.phone);
    setAddress(user.address ?? "");
    setVatNumber(user.vatNumber ?? "");
    setEditing(false);
    setError("");
  }

  const fields = [
    { label: "Prenom", value: firstName, setter: setFirstName, required: true },
    { label: "Nom", value: lastName, setter: setLastName, required: true },
    { label: "Societe", value: company, setter: setCompany, required: true },
    { label: "Telephone", value: phone, setter: setPhone, required: true },
    { label: "Adresse", value: address, setter: setAddress, required: false },
    { label: "N° TVA", value: vatNumber, setter: setVatNumber, required: false, mono: true },
  ];

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-[#1A1A1A]">
          Mon compte
        </h2>
        <div className="flex items-center gap-2">
          {success && (
            <span className="text-xs text-emerald-600 font-[family-name:var(--font-roboto)] flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Enregistre
            </span>
          )}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
              Modifier
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="text-xs font-[family-name:var(--font-roboto)] font-medium bg-[#1A1A1A] text-white px-3 py-1.5 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
              >
                {isPending ? "..." : "Enregistrer"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-xs font-[family-name:var(--font-roboto)] text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
              >
                Annuler
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-100">
          <p className="text-xs text-red-600 font-[family-name:var(--font-roboto)]">{error}</p>
        </div>
      )}

      <div className="divide-y divide-[#F0F0F0]">
        {/* Email + SIRET (non éditable) */}
        {[
          { label: "Email", value: user.email },
          { label: "SIRET", value: user.siret, mono: true },
        ].map(({ label, value, mono }) => (
          <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
            <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#9CA3AF] uppercase tracking-wider w-24 shrink-0">
              {label}
            </span>
            <span className={`text-sm text-[#1A1A1A] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
              {value}
            </span>
          </div>
        ))}

        {/* Champs éditables */}
        {fields.map(({ label, value, setter, required, mono }) => (
          <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 px-5 py-3">
            <span className="text-xs font-[family-name:var(--font-roboto)] font-medium text-[#9CA3AF] uppercase tracking-wider w-24 shrink-0">
              {label}{required && !editing ? "" : ""}
            </span>
            {editing ? (
              <input
                type="text"
                value={value}
                onChange={(e) => setter(e.target.value)}
                className={`flex-1 text-sm text-[#1A1A1A] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"} border border-[#E5E5E5] rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#1A1A1A] transition-colors`}
                placeholder={label}
              />
            ) : (
              <span className={`text-sm text-[#1A1A1A] ${mono ? "font-mono" : "font-[family-name:var(--font-roboto)]"}`}>
                {value || <span className="text-[#9CA3AF] italic">Non renseigne</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
