"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createAccessCode, deactivateAccessCode, reactivateAccessCode, deleteAccessCode } from "@/app/actions/admin/access-codes";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { COUNTRIES } from "@/lib/vat";

const EMPTY_PREFILL = {
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
  addressCountry: "",
};

interface AccessCodeItem {
  id: string;
  code: string;
  note: string | null;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
  firstAccessAt: string | null;
  lastAccessAt: string | null;
  usedBy: string | null;
  usedByName: string | null;
  usedAt: string | null;
  viewCount: number;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
  } | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatus(item: AccessCodeItem): { label: string; class: string; pulse?: string } {
  if (item.usedBy) return { label: "Inscrit", class: "badge-success" };
  if (!item.isActive) return { label: "Désactivé", class: "badge-neutral" };
  if (new Date(item.expiresAt) < new Date()) return { label: "Expiré", class: "badge-error" };
  if (item.firstAccessAt) return { label: "En cours", class: "badge-info", pulse: "bg-blue-500" };
  return { label: "Actif", class: "badge-warning", pulse: "bg-amber-500" };
}

export default function AccessCodesManager({ initialCodes }: { initialCodes: AccessCodeItem[] }) {
  const [codes, setCodes] = useState(initialCodes);
  const { confirm } = useConfirm();
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState("");
  const [prefill, setPrefill] = useState({ ...EMPTY_PREFILL });
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const countryOptions = useMemo<SelectOption[]>(() => {
    const eu = COUNTRIES.filter((c) => c.region === "EU");
    const dom = COUNTRIES.filter((c) => c.region === "DOM_TOM");
    const world = COUNTRIES.filter((c) => c.region === "WORLD");
    return [
      { value: "", label: "— Aucun (laisser au client) —" },
      ...eu.map((c) => ({ value: c.code, label: `🇪🇺  ${c.name}` })),
      ...dom.map((c) => ({ value: c.code, label: `🏝  ${c.name}` })),
      ...world.map((c) => ({ value: c.code, label: c.name })),
    ];
  }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const result = await createAccessCode({
        note,
        prefillFirstName: prefill.firstName,
        prefillLastName: prefill.lastName,
        prefillCompany: prefill.company,
        prefillEmail: prefill.email,
        prefillPhone: prefill.phone,
        prefillSiret: prefill.siret,
        prefillVatNumber: prefill.vatNumber,
        prefillAddressStreet: prefill.addressStreet,
        prefillAddressComplement: prefill.addressComplement,
        prefillAddressZip: prefill.addressZip,
        prefillAddressCity: prefill.addressCity,
        prefillAddressCountry: prefill.addressCountry,
      });
      if (result.success) {
        setNote("");
        setPrefill({ ...EMPTY_PREFILL });
        setShowCreate(false);
        window.location.reload();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    if (isActive) {
      await deactivateAccessCode(id);
    } else {
      await reactivateAccessCode(id);
    }
    setCodes((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, isActive: !isActive } : c
      )
    );
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      type: "danger",
      title: "Supprimer ce code d'accès ?",
      message: "Cette suppression est définitive et irréversible.",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    await deleteAccessCode(id);
    setCodes((prev) => prev.filter((c) => c.id !== id));
  }

  function copyCode(code: string, id: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Bouton créer */}
      <section className="card p-6">
        {!showCreate ? (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading text-sm font-semibold text-text-primary">
                Nouveau code d&apos;accès
              </h2>
              <p className="text-xs text-text-muted font-body mt-0.5">
                Générez un code à partager avec un prospect. Expire après 1 semaine.
              </p>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + Créer un code
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="font-heading text-sm font-semibold text-text-primary">
              Créer un code d&apos;accès
            </h2>
            <div>
              <label className="field-label" htmlFor="note">
                Note (optionnel)
              </label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex: Envoyé à Jean Dupont de la boutique XYZ le 18/03/2026 par email"
                className="field-input min-h-[80px] resize-y"
                rows={3}
              />
              <p className="text-xs text-text-muted mt-1">
                Cette note est visible uniquement par les admins.
              </p>
            </div>

            {/* Pré-remplissage inscription */}
            <div className="space-y-5">
              <div>
                <p className="text-xs font-body font-semibold text-text-muted uppercase tracking-widest">
                  Pré-remplir l&apos;inscription (optionnel)
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  Toutes les cases sont optionnelles — laissez vide pour que le client saisisse lui-même.
                </p>
              </div>

              {/* Sous-section : Identité */}
              <div>
                <p className="text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Identité du contact
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="field-label" htmlFor="prefill-firstName">Prénom</label>
                    <input
                      id="prefill-firstName"
                      type="text"
                      value={prefill.firstName}
                      onChange={(e) => setPrefill((p) => ({ ...p, firstName: e.target.value }))}
                      placeholder="Marie"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-lastName">Nom</label>
                    <input
                      id="prefill-lastName"
                      type="text"
                      value={prefill.lastName}
                      onChange={(e) => setPrefill((p) => ({ ...p, lastName: e.target.value }))}
                      placeholder="Dupont"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-email">Email</label>
                    <input
                      id="prefill-email"
                      type="email"
                      value={prefill.email}
                      onChange={(e) => setPrefill((p) => ({ ...p, email: e.target.value }))}
                      placeholder="contact@societe.fr"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-phone">Téléphone</label>
                    <input
                      id="prefill-phone"
                      type="tel"
                      value={prefill.phone}
                      onChange={(e) => setPrefill((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="0612345678"
                      className="field-input"
                    />
                  </div>
                </div>
              </div>

              {/* Sous-section : Société */}
              <div>
                <p className="text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Société
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="field-label" htmlFor="prefill-company">Raison sociale</label>
                    <input
                      id="prefill-company"
                      type="text"
                      value={prefill.company}
                      onChange={(e) => setPrefill((p) => ({ ...p, company: e.target.value }))}
                      placeholder="Mon Entreprise SARL"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-siret">SIRET</label>
                    <input
                      id="prefill-siret"
                      type="text"
                      value={prefill.siret}
                      onChange={(e) => setPrefill((p) => ({ ...p, siret: e.target.value.replace(/\D/g, "").slice(0, 14) }))}
                      placeholder="12345678901234"
                      maxLength={14}
                      className="field-input font-mono tracking-wide"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-vat">N° TVA intracommunautaire</label>
                    <input
                      id="prefill-vat"
                      type="text"
                      value={prefill.vatNumber}
                      onChange={(e) => setPrefill((p) => ({ ...p, vatNumber: e.target.value.toUpperCase().replace(/\s/g, "") }))}
                      placeholder="FR12345678901"
                      maxLength={20}
                      className="field-input font-mono tracking-wide"
                    />
                  </div>
                </div>
              </div>

              {/* Sous-section : Adresse */}
              <div>
                <p className="text-[11px] font-body font-semibold text-text-secondary uppercase tracking-wider mb-2">
                  Adresse de la société
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="field-label" htmlFor="prefill-street">Adresse</label>
                    <input
                      id="prefill-street"
                      type="text"
                      value={prefill.addressStreet}
                      onChange={(e) => setPrefill((p) => ({ ...p, addressStreet: e.target.value }))}
                      placeholder="12 rue des Lilas"
                      className="field-input"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-complement">Complément d&apos;adresse</label>
                    <input
                      id="prefill-complement"
                      type="text"
                      value={prefill.addressComplement}
                      onChange={(e) => setPrefill((p) => ({ ...p, addressComplement: e.target.value }))}
                      placeholder="Bâtiment B, 3e étage"
                      className="field-input"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="field-label" htmlFor="prefill-zip">Code postal</label>
                      <input
                        id="prefill-zip"
                        type="text"
                        value={prefill.addressZip}
                        onChange={(e) => setPrefill((p) => ({ ...p, addressZip: e.target.value }))}
                        placeholder="75011"
                        className="field-input"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="field-label" htmlFor="prefill-city">Ville</label>
                      <input
                        id="prefill-city"
                        type="text"
                        value={prefill.addressCity}
                        onChange={(e) => setPrefill((p) => ({ ...p, addressCity: e.target.value }))}
                        placeholder="Paris"
                        className="field-input"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="prefill-country">Pays</label>
                    <CustomSelect
                      id="prefill-country"
                      value={prefill.addressCountry}
                      onChange={(v) => setPrefill((p) => ({ ...p, addressCountry: v }))}
                      options={countryOptions}
                      searchable
                      placeholder="— Aucun (laisser au client) —"
                      aria-label="Pays de la société"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={creating} className="btn-primary">
                {creating ? "Génération..." : "Générer le code"}
              </button>
              <button onClick={() => setShowCreate(false)} className="btn-secondary">
                Annuler
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Légende des statuts */}
      <section className="card p-5">
        <h2 className="font-heading text-sm font-semibold text-text-primary mb-3">
          Légende des statuts
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { label: "Actif", cls: "badge-warning", desc: "Code créé, pas encore utilisé par le prospect." },
            { label: "En cours", cls: "badge-info", desc: "Le prospect a utilisé le code pour naviguer sur le site." },
            { label: "Inscrit", cls: "badge-success", desc: "Le prospect s'est inscrit avec ce code." },
            { label: "Expiré", cls: "badge-error", desc: "Le code a dépassé sa durée de validité (7 jours)." },
            { label: "Désactivé", cls: "badge-neutral", desc: "Le code a été désactivé manuellement par un admin." },
          ].map((s) => (
            <div key={s.label} className="flex items-start gap-2.5">
              <span className={`badge ${s.cls} shrink-0 mt-0.5`}>{s.label}</span>
              <p className="text-xs text-text-muted font-body leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Liste des codes */}
      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold text-text-secondary uppercase tracking-wider border-b border-border pb-2">
          Codes ({codes.length})
        </h2>

        {codes.length === 0 ? (
          <p className="text-sm text-text-muted py-8 text-center">
            Aucun code d&apos;accès créé pour le moment.
          </p>
        ) : (
          <div className="space-y-2">
            {codes.map((item) => {
              const status = getStatus(item);
              return (
                <div key={item.id} className="card p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    {/* Infos principales */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-heading text-base font-bold text-text-primary tracking-wider">
                          {item.code}
                        </span>
                        <span className={`badge ${status.class}`}>
                          {status.label}
                        </span>
                        <button
                          onClick={() => copyCode(item.code, item.id)}
                          className="text-text-muted hover:text-text-primary transition-colors"
                          title="Copier le code"
                        >
                          {copiedId === item.id ? (
                            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {item.note && (
                        <p className="text-xs text-text-muted font-body mb-2 line-clamp-2">
                          {item.note}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-body">
                        <span>Créé le {formatDate(item.createdAt)}</span>
                        <span>Expire le {formatDate(item.expiresAt)}</span>
                        <span>{item.viewCount} page{item.viewCount !== 1 ? "s" : ""} vue{item.viewCount !== 1 ? "s" : ""}</span>
                        {item.firstAccessAt && (
                          <span>Premier accès : {formatDate(item.firstAccessAt)}</span>
                        )}
                      </div>

                      {item.user && (
                        <div className="mt-2 flex items-center gap-2 text-xs">
                          <span className="badge badge-success">Inscrit</span>
                          <span className="text-text-secondary font-medium">
                            {item.user.firstName} {item.user.lastName}
                          </span>
                          <span className="text-text-muted">({item.user.company})</span>
                          {item.usedAt && (
                            <span className="text-text-muted">le {formatDate(item.usedAt)}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Link
                        href={`/admin/codes-acces/${item.id}`}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
                        title="Voir les détails"
                      >
                        <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </Link>
                      {!item.usedBy && (
                        <button
                          onClick={() => handleToggle(item.id, item.isActive)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
                          title={item.isActive ? "Désactiver" : "Réactiver"}
                        >
                          {item.isActive ? (
                            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 transition-colors"
                        title="Supprimer"
                      >
                        <svg className="w-4 h-4 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
