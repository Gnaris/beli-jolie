"use client";

import { useState, useTransition } from "react";
import { updateCompanyInfo, type CompanyInfoData } from "@/app/actions/admin/company-info";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface CompanyInfoFormProps {
  initialData: CompanyInfoData | null;
}

const FIELDS: { key: keyof CompanyInfoData; label: string; placeholder: string; required?: boolean; colSpan?: number }[] = [
  { key: "shopName", label: "Nom de la boutique", placeholder: "Ex: Ma Boutique", colSpan: 2 },
  { key: "name", label: "Raison sociale", placeholder: "Ex: Ma Société SAS", required: true, colSpan: 2 },
  { key: "legalForm", label: "Forme juridique", placeholder: "Ex: SAS, SARL, EURL..." },
  { key: "capital", label: "Capital social (€)", placeholder: "Ex: 10 000" },
  { key: "siret", label: "SIRET", placeholder: "Ex: 123 456 789 00012" },
  { key: "rcs", label: "RCS", placeholder: "Ex: Paris B 123 456 789" },
  { key: "tvaNumber", label: "N° TVA intracommunautaire", placeholder: "Ex: FR12345678901" },
  { key: "address", label: "Adresse", placeholder: "Ex: 12 rue de la Paix", colSpan: 2 },
  { key: "postalCode", label: "Code postal", placeholder: "Ex: 75001" },
  { key: "city", label: "Ville", placeholder: "Ex: Paris" },
  { key: "country", label: "Pays", placeholder: "France" },
  { key: "phone", label: "Téléphone", placeholder: "Ex: 01 23 45 67 89" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "Ex: +33 6 12 34 56 78" },
  { key: "email", label: "Email de contact", placeholder: "Ex: contact@example.com" },
  { key: "website", label: "Site web", placeholder: "Ex: www.example.com" },
  { key: "director", label: "Directeur de publication", placeholder: "Ex: Jean Dupont", colSpan: 2 },
  { key: "hostName", label: "Hébergeur (nom)", placeholder: "Ex: Vercel Inc." },
  { key: "hostAddress", label: "Hébergeur (adresse)", placeholder: "Ex: 340 S Lemon Ave, Walnut, CA" },
  { key: "hostPhone", label: "Hébergeur (téléphone)", placeholder: "Ex: +1 (559) 288-7060" },
  { key: "hostEmail", label: "Hébergeur (email)", placeholder: "Ex: privacy@vercel.com" },
];

export default function CompanyInfoForm({ initialData }: CompanyInfoFormProps) {
  const [form, setForm] = useState<CompanyInfoData>({
    shopName: initialData?.shopName || "",
    name: initialData?.name || "",
    legalForm: initialData?.legalForm || "",
    capital: initialData?.capital || "",
    siret: initialData?.siret || "",
    rcs: initialData?.rcs || "",
    tvaNumber: initialData?.tvaNumber || "",
    address: initialData?.address || "",
    city: initialData?.city || "",
    postalCode: initialData?.postalCode || "",
    country: initialData?.country || "France",
    phone: initialData?.phone || "",
    whatsapp: initialData?.whatsapp || "",
    email: initialData?.email || "",
    website: initialData?.website || "",
    director: initialData?.director || "",
    hostName: initialData?.hostName || "",
    hostAddress: initialData?.hostAddress || "",
    hostPhone: initialData?.hostPhone || "",
    hostEmail: initialData?.hostEmail || "",
  });
  const [isPending, startTransition] = useTransition();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    showLoading();
    startTransition(async () => {
      try {
        const result = await updateCompanyInfo(form);
        if (result.success) {
          setMessage({ type: "success", text: "Informations société mises à jour. Les documents légaux ont été mis à jour." });
        } else {
          setMessage({ type: "error", text: result.error || "Erreur" });
        }
      } finally {
        hideLoading();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.colSpan === 2 ? "sm:col-span-2" : ""}>
            <label className="field-label">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <input
              type="text"
              value={form[field.key] || ""}
              onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
              placeholder={field.placeholder}
              required={field.required}
              className="field-input"
            />
          </div>
        ))}
      </div>

      {message && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm font-body ${
            message.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary"
        >
          {isPending ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Enregistrement...
            </>
          ) : (
            "Enregistrer"
          )}
        </button>
      </div>
    </form>
  );
}
