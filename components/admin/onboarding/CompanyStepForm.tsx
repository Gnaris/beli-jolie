"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateCompanyInfo,
  type CompanyInfoData,
} from "@/app/actions/admin/company-info";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

/**
 * Version wizard, minimale : uniquement les champs indispensables pour
 * afficher un site en règle. Les champs avancés (hébergeur, directeur de
 * publication, RCS, capital…) restent modifiables depuis Paramètres > Société.
 */
export default function CompanyStepForm({
  initial,
}: {
  initial: CompanyInfoData | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const [form, setForm] = useState<CompanyInfoData>({
    shopName: initial?.shopName || "",
    name: initial?.name || "",
    legalForm: initial?.legalForm || "",
    capital: initial?.capital || "",
    siret: initial?.siret || "",
    rcs: initial?.rcs || "",
    tvaNumber: initial?.tvaNumber || "",
    address: initial?.address || "",
    postalCode: initial?.postalCode || "",
    city: initial?.city || "",
    country: initial?.country || "France",
    phone: initial?.phone || "",
    whatsapp: initial?.whatsapp || "",
    email: initial?.email || "",
    website: initial?.website || "",
    director: initial?.director || "",
    hostName: initial?.hostName || "",
    hostAddress: initial?.hostAddress || "",
    hostPhone: initial?.hostPhone || "",
    hostEmail: initial?.hostEmail || "",
  });

  const canSubmit = !!form.shopName?.trim() && !!form.name.trim() && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await updateCompanyInfo(form);
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer.");
        return;
      }
      const step = await markStepCompleted("company");
      if (!step.success) {
        toast.warning("Enregistré", "Mais l'étape n'a pas pu être marquée. Continuons.");
      } else {
        toast.success("Société enregistrée", "On passe à l'étape suivante.");
      }
      router.push("/admin/bienvenue/marque");
    });
  };

  const input =
    "w-full rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";
  const label = "text-sm font-medium text-text-primary mb-1.5 block";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section>
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-emerald-500 rounded" /> Vitrine
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>
              Nom de la boutique <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.shopName || ""}
              onChange={(e) => setForm({ ...form, shopName: e.target.value })}
              placeholder="Ex : Chez Sophie"
              required
              className={input}
            />
            <p className="text-xs text-text-secondary/70 mt-1">
              Ce nom apparaîtra en haut du site et dans l&apos;onglet du navigateur.
            </p>
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-emerald-500 rounded" /> Entreprise
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>
              Raison sociale <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : Sophie Martin SASU"
              required
              className={input}
            />
          </div>
          <div>
            <label className={label}>SIRET</label>
            <input
              type="text"
              value={form.siret || ""}
              onChange={(e) => setForm({ ...form, siret: e.target.value })}
              placeholder="14 chiffres"
              className={input}
            />
          </div>
          <div>
            <label className={label}>N° TVA intracommunautaire</label>
            <input
              type="text"
              value={form.tvaNumber || ""}
              onChange={(e) => setForm({ ...form, tvaNumber: e.target.value })}
              placeholder="FR12 345 678 901"
              className={input}
            />
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-emerald-500 rounded" /> Adresse
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3">
            <label className={label}>Adresse</label>
            <input
              type="text"
              value={form.address || ""}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="12 rue de la Paix"
              className={input}
            />
          </div>
          <div>
            <label className={label}>Code postal</label>
            <input
              type="text"
              value={form.postalCode || ""}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
              placeholder="75001"
              className={input}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Ville</label>
            <input
              type="text"
              value={form.city || ""}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="Paris"
              className={input}
            />
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-emerald-500 rounded" /> Contact
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Email de contact</label>
            <input
              type="email"
              value={form.email || ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="contact@maboutique.fr"
              className={input}
            />
            <p className="text-xs text-text-secondary/70 mt-1">
              Sert aussi à recevoir les notifications de commandes.
            </p>
          </div>
          <div>
            <label className={label}>Téléphone</label>
            <input
              type="text"
              value={form.phone || ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="01 23 45 67 89"
              className={input}
            />
          </div>
        </div>
      </section>

      <div className="rounded-2xl bg-emerald-50/60 border border-emerald-100 p-4 text-sm text-emerald-800">
        <p className="font-semibold mb-1">Vous pourrez tout modifier plus tard</p>
        <p className="text-emerald-800/80">
          Ces informations sont reprises automatiquement sur vos factures, vos CGV
          et vos mentions légales. Elles restent modifiables à tout moment depuis
          <strong> Paramètres &rsaquo; Société</strong>.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-emerald-500 to-teal-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer et continuer"}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </form>
  );
}
