"use client";

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import CountryCombobox from "@/components/ui/CountryCombobox";
import {
  createAdminClientCard,
  updateAdminClientCard,
  deleteAdminClientCard,
  type AdminClientCardInput,
} from "@/app/actions/admin/admin-client-cards";
import AdminCardPfsOrdersSection from "./AdminCardPfsOrdersSection";

export interface AdminClientCardForDrawer {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  siret: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  hasPfs: boolean;
  hasAnkorstore: boolean;
  hasEfashion: boolean;
  hasFaire: boolean;
  hasMicrostore: boolean;
  hasPassage: boolean;
  lastOrderAt: string | null;
  lastMessageSentAt: string | null;
  orderDiscountType: "PERCENT" | "AMOUNT" | null;
  orderDiscountValue: string | null;
  shippingFree: boolean;
  shippingDiscountType: "PERCENT" | "AMOUNT" | null;
  shippingDiscountValue: string | null;
  note: string | null;
  pfsCustomerId: string | null;
  importedFromMarketplace: string | null;
}

interface Props {
  mode: "create" | "edit";
  card: AdminClientCardForDrawer | null;
  onClose: () => void;
}

type ShipMode = "OFFERTE" | "PERCENT" | "AMOUNT";

function toDateInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const MARKETPLACES = [
  { key: "hasPfs", label: "PFS", initial: "P", gradient: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  { key: "hasAnkorstore", label: "Ankorstore", initial: "A", gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  { key: "hasEfashion", label: "eFashion", initial: "E", gradient: "linear-gradient(135deg,#db2777,#ec4899)" },
  { key: "hasFaire", label: "Faire", initial: "F", gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
  { key: "hasMicrostore", label: "Microstore", initial: "M", gradient: "linear-gradient(135deg,#64748b,#334155)" },
  { key: "hasPassage", label: "Passage", initial: "Pa", gradient: "linear-gradient(135deg,#0d9488,#14b8a6)" },
] as const;

export default function AdminCardDrawer({ mode, card, onClose }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [firstName, setFirstName] = useState(card?.firstName ?? "");
  const [lastName, setLastName] = useState(card?.lastName ?? "");
  const [company, setCompany] = useState(card?.company ?? "");
  const [siret, setSiret] = useState(card?.siret ?? "");
  const [vatNumber, setVatNumber] = useState(card?.vatNumber ?? "");
  const [email, setEmail] = useState(card?.email ?? "");
  const [phone, setPhone] = useState(card?.phone ?? "");
  const [website, setWebsite] = useState(card?.website ?? "");
  const [addressLine, setAddressLine] = useState(card?.addressLine ?? "");
  const [postalCode, setPostalCode] = useState(card?.postalCode ?? "");
  const [city, setCity] = useState(card?.city ?? "");
  const [countryCode, setCountryCode] = useState<string | null>(card?.countryCode ?? (mode === "create" ? "FR" : null));
  const [hasPfs, setHasPfs] = useState(card?.hasPfs ?? false);
  const [hasAnkorstore, setHasAnkorstore] = useState(card?.hasAnkorstore ?? false);
  const [hasEfashion, setHasEfashion] = useState(card?.hasEfashion ?? false);
  const [hasFaire, setHasFaire] = useState(card?.hasFaire ?? false);
  const [hasMicrostore, setHasMicrostore] = useState(card?.hasMicrostore ?? false);
  const [hasPassage, setHasPassage] = useState(card?.hasPassage ?? false);
  const [lastOrderAt, setLastOrderAt] = useState(toDateInput(card?.lastOrderAt ?? null));
  const [lastMessageSentAt, setLastMessageSentAt] = useState(toDateInput(card?.lastMessageSentAt ?? null));

  const [orderDiscountEnabled, setOrderDiscountEnabled] = useState(!!card?.orderDiscountType);
  const [orderDiscountType, setOrderDiscountType] = useState<"PERCENT" | "AMOUNT">(card?.orderDiscountType ?? "PERCENT");
  const [orderDiscountValue, setOrderDiscountValue] = useState(card?.orderDiscountValue ?? "");

  const [shippingEnabled, setShippingEnabled] = useState(
    !!card && (card.shippingFree || !!card.shippingDiscountType)
  );
  const [shippingMode, setShippingMode] = useState<ShipMode>(
    card?.shippingFree ? "OFFERTE" : card?.shippingDiscountType ?? "OFFERTE"
  );
  const [shippingDiscountValue, setShippingDiscountValue] = useState(card?.shippingDiscountValue ?? "");

  const [note, setNote] = useState(card?.note ?? "");

  // Close on ESC
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const marketplaceValues = { hasPfs, hasAnkorstore, hasEfashion, hasFaire, hasMicrostore, hasPassage };
  const marketplaceSetters = {
    hasPfs: setHasPfs,
    hasAnkorstore: setHasAnkorstore,
    hasEfashion: setHasEfashion,
    hasFaire: setHasFaire,
    hasMicrostore: setHasMicrostore,
    hasPassage: setHasPassage,
  } as const;

  function buildInput(): AdminClientCardInput {
    return {
      firstName,
      lastName,
      company: company || null,
      siret: siret || null,
      vatNumber: vatNumber || null,
      email: email || null,
      phone: phone || null,
      website: website || null,
      addressLine: addressLine || null,
      postalCode: postalCode || null,
      city: city || null,
      countryCode: countryCode || null,
      hasPfs,
      hasAnkorstore,
      hasEfashion,
      hasFaire,
      hasMicrostore,
      hasPassage,
      lastOrderAt: lastOrderAt || null,
      lastMessageSentAt: lastMessageSentAt || null,
      orderDiscountType: orderDiscountEnabled ? orderDiscountType : null,
      orderDiscountValue: orderDiscountEnabled && orderDiscountValue !== "" ? Number(orderDiscountValue) : null,
      shippingFree: shippingEnabled && shippingMode === "OFFERTE",
      shippingDiscountType:
        shippingEnabled && shippingMode !== "OFFERTE" ? shippingMode : null,
      shippingDiscountValue:
        shippingEnabled && shippingMode !== "OFFERTE" && shippingDiscountValue !== ""
          ? Number(shippingDiscountValue)
          : null,
      note: note || null,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Champs requis", "Le prénom et le nom sont obligatoires.");
      return;
    }
    const input = buildInput();
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createAdminClientCard(input);
          toast.success("Fiche créée", `${firstName} ${lastName} ajouté à votre répertoire.`);
        } else if (card) {
          await updateAdminClientCard(card.id, input);
          toast.success("Fiche mise à jour");
        }
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error("Erreur", msg);
      }
    });
  }

  async function handleDelete() {
    if (!card) return;
    const ok = await confirm({
      type: "danger",
      title: "Supprimer cette fiche ?",
      message: `La fiche de ${card.firstName} ${card.lastName} sera définitivement supprimée de votre répertoire.`,
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteAdminClientCard(card.id);
        toast.success("Fiche supprimée");
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error("Erreur", msg);
      }
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 h-full w-full max-w-[640px] bg-bg-primary shadow-2xl z-50 overflow-y-auto">
        {/* Header aurora violet */}
        <div className="relative overflow-hidden bg-gradient-to-br from-violet-700 to-violet-900 px-6 py-6">
          <div className="absolute -top-16 -right-10 w-40 h-40 rounded-full blur-3xl bg-violet-400/40" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-body font-bold uppercase tracking-[0.18em] text-violet-200">
                Fiche client admin
              </p>
              <h2 className="font-heading text-2xl font-bold text-white mt-1">
                {mode === "create" ? "Nouvelle fiche" : `${card?.firstName ?? ""} ${card?.lastName ?? ""}`.trim() || card?.company || "Client"}
              </h2>
              <p className="text-xs text-violet-200 mt-1">
                Répertoire personnel — visible uniquement par vous
              </p>
              {card?.importedFromMarketplace === "PFS" && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/25 px-2 py-0.5 text-[11px] text-white">
                  <span
                    className="w-3.5 h-3.5 rounded-sm text-white text-[9px] font-heading font-bold flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
                  >
                    P
                  </span>
                  Importée automatiquement depuis Paris Fashion Shop
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
              aria-label="Fermer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Identité */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-violet-600" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Identité</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom *">
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field" required />
              </Field>
              <Field label="Nom *">
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="field" required />
              </Field>
              <Field label="Société" className="col-span-2">
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nom de la boutique" className="field" />
              </Field>
              <Field label="SIRET">
                <input value={siret} onChange={(e) => setSiret(e.target.value)} placeholder="14 chiffres" className="field font-mono" />
              </Field>
              <Field label="N° TVA intracommunautaire">
                <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="FR…" className="field font-mono" />
              </Field>
            </div>
          </section>

          {/* Contact */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-sky-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Contact</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" className="col-span-2">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@boutique.fr" className="field" />
              </Field>
              <Field label="Téléphone">
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" className="field" />
              </Field>
              <Field label="Site web (optionnel)">
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="field" />
              </Field>
              <Field label="Adresse" className="col-span-2">
                <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="12 rue des Lilas" className="field" />
              </Field>
              <Field label="Code postal">
                <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="75001" className="field font-mono" />
              </Field>
              <Field label="Ville">
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris" className="field" />
              </Field>
              <Field label="Pays" className="col-span-2">
                <CountryCombobox value={countryCode} onChange={setCountryCode} />
              </Field>
            </div>
          </section>

          {mode === "edit" && card?.id && (
            <AdminCardPfsOrdersSection cardId={card.id} hasPfs={card.hasPfs || Boolean(card.pfsCustomerId)} />
          )}

          {/* Marketplaces */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-emerald-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
                D&apos;où vient ce client ? (plusieurs choix possibles)
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {MARKETPLACES.map((mp) => {
                const checked = marketplaceValues[mp.key];
                return (
                  <label
                    key={mp.key}
                    className={`relative flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-all text-[13px] ${
                      checked
                        ? "border-text-primary bg-bg-secondary text-text-primary font-semibold shadow-[0_0_0_2px_rgba(15,23,42,0.06)]"
                        : "border-border bg-bg-primary text-text-secondary hover:border-border-strong"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => marketplaceSetters[mp.key](e.target.checked)}
                      className="absolute opacity-0 inset-0 cursor-pointer"
                    />
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-[10px] font-bold"
                      style={{ background: mp.gradient }}
                    >
                      {mp.initial}
                    </span>
                    <span>{mp.label}</span>
                    {checked && (
                      <span className="ml-auto inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px]">✓</span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>

          {/* Historique */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-amber-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Historique</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date dernière commande">
                <input type="date" value={lastOrderAt} onChange={(e) => setLastOrderAt(e.target.value)} className="field" />
              </Field>
              <Field label="Date dernier message envoyé">
                <input type="date" value={lastMessageSentAt} onChange={(e) => setLastMessageSentAt(e.target.value)} className="field" />
              </Field>
            </div>
          </section>

          {/* Remises et avantages */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-emerald-600" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Remises et avantages</h3>
            </div>

            <div className="rounded-xl border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={orderDiscountEnabled}
                  onChange={(e) => setOrderDiscountEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-text-primary focus:ring-slate-400"
                />
                <span className="text-[13px] font-medium text-text-secondary">Remise sur commande</span>
              </label>
              {orderDiscountEnabled && (
                <div className="flex items-center gap-2 pl-6 flex-wrap">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={orderDiscountValue}
                    onChange={(e) => setOrderDiscountValue(e.target.value)}
                    placeholder="10"
                    className="field w-24 font-mono tabular-nums"
                  />
                  <div className="inline-flex rounded-lg border border-border bg-bg-secondary p-0.5">
                    <button
                      type="button"
                      onClick={() => setOrderDiscountType("PERCENT")}
                      className={`px-3 h-8 rounded-md text-[13px] font-semibold transition-colors ${
                        orderDiscountType === "PERCENT" ? "bg-bg-primary shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrderDiscountType("AMOUNT")}
                      className={`px-3 h-8 rounded-md text-[13px] font-semibold transition-colors ${
                        orderDiscountType === "AMOUNT" ? "bg-bg-primary shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                      }`}
                    >
                      €
                    </button>
                  </div>
                  <span className="text-[11.5px] text-text-muted">sur chaque commande</span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shippingEnabled}
                  onChange={(e) => setShippingEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-border text-text-primary focus:ring-slate-400"
                />
                <span className="text-[13px] font-medium text-text-secondary">Remise sur la livraison</span>
              </label>
              {shippingEnabled && (
                <div className="flex items-center gap-2 pl-6 flex-wrap">
                  <div className="inline-flex rounded-lg border border-border bg-bg-secondary p-0.5">
                    {(["OFFERTE", "PERCENT", "AMOUNT"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setShippingMode(m)}
                        className={`px-3 h-8 rounded-md text-[13px] font-semibold transition-colors ${
                          shippingMode === m ? "bg-bg-primary shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        {m === "OFFERTE" ? "Offerte" : m === "PERCENT" ? "%" : "€"}
                      </button>
                    ))}
                  </div>
                  {shippingMode !== "OFFERTE" && (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={shippingDiscountValue}
                      onChange={(e) => setShippingDiscountValue(e.target.value)}
                      placeholder="Montant"
                      className="field w-24 font-mono tabular-nums"
                    />
                  )}
                  <span className="text-[11.5px] text-text-muted">
                    {shippingMode === "OFFERTE" ? "livraison gratuite pour ce client" : "réduction sur la livraison"}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Note personnelle */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-rose-500" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">Note personnelle</h3>
            </div>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notes libres : produits attendus, préférences, contexte de la relation, à faire au prochain contact…"
              className="field resize-none w-full"
            />
          </section>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="text-[13px] font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
              >
                Supprimer la fiche
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-4 h-10 rounded-xl border border-border text-text-secondary text-[13px] font-medium hover:bg-bg-secondary disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-5 h-10 rounded-xl bg-gradient-to-br from-text-primary to-text-secondary text-white text-[13px] font-semibold shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      </aside>

      <style jsx>{`
        .field {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--bg-primary, #fff);
          font-size: 14px;
          color: var(--text-primary, #0f172a);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field:focus {
          border-color: var(--border-strong, #cbd5e1);
          box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08);
        }
      `}</style>
    </>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="text-[11.5px] font-medium text-text-secondary mb-1 block">{label}</label>
      {children}
    </div>
  );
}
