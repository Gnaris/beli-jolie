"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useToast } from "@/components/ui/Toast";
import { COUNTRIES } from "@/lib/vat";
import { updateClientProfile } from "@/app/actions/admin/updateClientProfile";

export interface ClientProfileEditorProps {
  clientId: string;
  initial: {
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

export default function ClientProfileEditor({ clientId, initial }: ClientProfileEditorProps) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [email, setEmail] = useState(initial.email);
  const [company, setCompany] = useState(initial.company);
  const [phone, setPhone] = useState(initial.phone);
  const [siret, setSiret] = useState(initial.siret ?? "");
  const [vatNumber, setVatNumber] = useState(initial.vatNumber ?? "");
  const [addressStreet, setAddressStreet] = useState(initial.addressStreet ?? "");
  const [addressComplement, setAddressComplement] = useState(initial.addressComplement ?? "");
  const [addressZip, setAddressZip] = useState(initial.addressZip ?? "");
  const [addressCity, setAddressCity] = useState(initial.addressCity ?? "");
  const [addressCountry, setAddressCountry] = useState(initial.addressCountry ?? "");

  const countryOptions: SelectOption[] = useMemo(
    () => COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
    [],
  );

  const vatChanged =
    (vatNumber.trim().toUpperCase() || null) !== (initial.vatNumber?.toUpperCase() || null);
  const emailChanged = email.trim().toLowerCase() !== initial.email.trim().toLowerCase();

  function resetToInitial() {
    setFirstName(initial.firstName);
    setLastName(initial.lastName);
    setEmail(initial.email);
    setCompany(initial.company);
    setPhone(initial.phone);
    setSiret(initial.siret ?? "");
    setVatNumber(initial.vatNumber ?? "");
    setAddressStreet(initial.addressStreet ?? "");
    setAddressComplement(initial.addressComplement ?? "");
    setAddressZip(initial.addressZip ?? "");
    setAddressCity(initial.addressCity ?? "");
    setAddressCountry(initial.addressCountry ?? "");
  }

  function close() {
    resetToInitial();
    setOpen(false);
  }

  function handleSave() {
    startTransition(async () => {
      const res = await updateClientProfile(clientId, {
        firstName,
        lastName,
        email,
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
        toast.error("Modification refusée", res.error);
        return;
      }
      toast.success("Profil client mis à jour");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-secondary hover:bg-bg-tertiary border border-border hover:border-border-strong px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
        </svg>
        Modifier
      </button>

      {open && (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Édition du profil client">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]"
            onClick={close}
            aria-hidden="true"
          />
          <div className="absolute inset-0 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
            <div className="relative bg-bg-primary rounded-3xl shadow-xl border border-border w-full max-w-2xl my-8">
              {/* Header aurora */}
              <div className="relative overflow-hidden rounded-t-3xl bg-gradient-to-br from-emerald-50 via-bg-primary to-sky-50 border-b border-border px-6 py-5">
                <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-emerald-100/60 blur-2xl" />
                <div className="relative">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700 mb-1">
                    Fiche client
                  </p>
                  <h2 className="font-heading text-xl font-bold text-text-primary">
                    Modifier les informations
                  </h2>
                  <p className="text-xs text-text-muted mt-1">
                    Toutes les données du dossier client — email, identité, entreprise, adresse.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Fermer"
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-bg-primary/80 border border-border flex items-center justify-center hover:bg-bg-secondary transition-colors"
                >
                  <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-6">
                {emailChanged && (
                  <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3">
                    <p className="text-xs text-sky-900 leading-relaxed">
                      <strong>Nouvelle adresse email.</strong> La session en cours du client reste valide — il utilisera la nouvelle adresse à sa prochaine connexion. Vérifiez bien l&apos;orthographe.
                    </p>
                  </div>
                )}

                {vatChanged && vatNumber.trim() !== "" && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-xs text-amber-900 leading-relaxed">
                      <strong>N° TVA modifié.</strong> La validation VIES précédente sera effacée. Vous devrez re-vérifier le nouveau numéro puis rebasculer l&apos;exonération TVA si applicable.
                    </p>
                  </div>
                )}

                {/* Contact */}
                <Section title="Contact">
                  <TwoCol>
                    <Field label="Prénom" value={firstName} onChange={setFirstName} required />
                    <Field label="Nom" value={lastName} onChange={setLastName} required />
                  </TwoCol>
                  <Field label="Email" type="email" value={email} onChange={setEmail} required />
                  <TwoCol>
                    <Field label="Téléphone" value={phone} onChange={setPhone} required />
                    <Field label="Société" value={company} onChange={setCompany} required />
                  </TwoCol>
                </Section>

                {/* Entreprise */}
                <Section title="Entreprise">
                  <TwoCol>
                    <Field label="SIRET" value={siret} onChange={setSiret} mono />
                    <Field label="N° TVA intracom" value={vatNumber} onChange={setVatNumber} mono />
                  </TwoCol>
                </Section>

                {/* Adresse */}
                <Section title="Adresse">
                  <Field label="Rue et numéro" value={addressStreet} onChange={setAddressStreet} />
                  <Field label="Complément" value={addressComplement} onChange={setAddressComplement} />
                  <TwoCol>
                    <Field label="Code postal" value={addressZip} onChange={setAddressZip} />
                    <Field label="Ville" value={addressCity} onChange={setAddressCity} />
                  </TwoCol>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
                      Pays
                    </label>
                    <CustomSelect
                      value={addressCountry}
                      onChange={setAddressCountry}
                      options={countryOptions}
                      placeholder="Sélectionner un pays"
                      searchable
                    />
                  </div>
                </Section>
              </div>

              <div className="px-6 py-4 border-t border-border bg-bg-secondary/40 rounded-b-3xl flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={isPending}
                  className="text-sm font-medium text-text-secondary hover:text-text-primary px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="text-sm font-medium bg-text-primary text-text-inverse hover:bg-text-secondary px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPending ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1 h-4 rounded-full bg-gradient-to-b from-emerald-500 to-sky-500" />
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={`w-full text-sm text-text-primary ${mono ? "font-mono" : ""} bg-bg-primary border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-text-primary focus:ring-2 focus:ring-text-primary/10 transition`}
      />
    </div>
  );
}
