"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
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
import AdminCardOrderedProductsSection from "./AdminCardOrderedProductsSection";

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

const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-rose-500 to-rose-700",
  "bg-gradient-to-br from-emerald-500 to-emerald-700",
  "bg-gradient-to-br from-sky-500 to-sky-700",
  "bg-gradient-to-br from-violet-500 to-violet-700",
  "bg-gradient-to-br from-amber-500 to-amber-700",
  "bg-gradient-to-br from-teal-500 to-teal-700",
];

function avatarGradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

function initialsOf(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

function formatDateShort(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminCardDrawer({ mode, card, onClose }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  // Animation d'entrée : monté hors-écran, puis on bascule visible au prochain tick
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setVisible(false);
    setTimeout(() => onClose(), 260);
  };

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
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        handleClose();
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
        handleClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error("Erreur", msg);
      }
    });
  }

  const displayName = mode === "create"
    ? "Nouvelle fiche"
    : `${card?.firstName ?? ""} ${card?.lastName ?? ""}`.trim() || card?.company || "Client";
  const avatarGradient = card?.id ? avatarGradientFor(card.id) : "bg-gradient-to-br from-violet-500 to-violet-700";
  const initials = card ? initialsOf(card.firstName, card.lastName) : "";
  const activeMarketplaces = MARKETPLACES.filter((mp) => marketplaceValues[mp.key]);

  const content = (
    <>
      <div
        className={`fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[9500] transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={handleClose}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-full lg:w-[72vw] lg:min-w-[900px] lg:max-w-[1400px] bg-bg-secondary shadow-2xl z-[9501] overflow-y-auto transform transition-transform duration-300 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header ardoise avec padding généreux */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 px-10 py-10">
          <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full blur-3xl bg-slate-500/25" />
          <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full blur-3xl bg-slate-600/30" />

          <div className="relative flex items-start justify-between gap-5">
            <div className="flex items-start gap-5 min-w-0 flex-1">
              <div className={`w-20 h-20 rounded-2xl text-white flex items-center justify-center font-heading font-bold text-3xl shadow-xl shrink-0 ring-2 ring-white/10 ${avatarGradient}`}>
                {initials || "?"}
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] font-body font-bold uppercase tracking-[0.2em] text-slate-300">
                  Fiche client — Répertoire personnel
                </p>
                <h2 className="font-heading text-3xl font-bold text-white truncate">
                  {displayName}
                </h2>
                {(card?.company || card?.email) && (
                  <p className="text-sm text-slate-300 truncate">
                    {card?.company && <span>{card.company}</span>}
                    {card?.company && card?.email && <span className="text-slate-500"> · </span>}
                    {card?.email && <span className="text-white/85">{card.email}</span>}
                  </p>
                )}
                {(activeMarketplaces.length > 0 || card?.importedFromMarketplace === "PFS") && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {activeMarketplaces.map((mp) => (
                      <span key={mp.key} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur border border-white/20 px-2.5 py-1 text-[11px] text-white font-medium">
                        <span
                          className="w-4 h-4 rounded text-white text-[9px] font-bold flex items-center justify-center"
                          style={{ background: mp.gradient }}
                        >
                          {mp.initial}
                        </span>
                        {mp.label}
                      </span>
                    ))}
                    {card?.importedFromMarketplace === "PFS" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/25 border border-emerald-300/40 px-2.5 py-1 text-[11px] text-emerald-100 font-medium">
                        Importée depuis PFS
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0"
              aria-label="Fermer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {mode === "edit" && (card?.lastOrderAt || card?.lastMessageSentAt) && (
            <div className="relative mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">Dernière commande</p>
                <p className="text-sm font-heading font-bold text-white mt-1">{formatDateShort(card?.lastOrderAt ?? null)}</p>
              </div>
              <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">Dernier message</p>
                <p className="text-sm font-heading font-bold text-white mt-1">{formatDateShort(card?.lastMessageSentAt ?? null)}</p>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          {/* Ligne 1 : Identité | Contact */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard accent="violet" title="Identité">
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
                <Field label="N° TVA">
                  <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="FR…" className="field font-mono" />
                </Field>
              </div>
            </SectionCard>

            <SectionCard accent="sky" title="Contact">
              <div className="space-y-3">
                <Field label="Email">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@boutique.fr" className="field" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Téléphone">
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" className="field" />
                  </Field>
                  <Field label="Site web">
                    <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="field" />
                  </Field>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Ligne 2 : Adresse — structure claire, 3 lignes */}
          <SectionCard accent="teal" title="Adresse de livraison">
            <div className="space-y-3">
              <Field label="Rue et numéro">
                <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="12 rue des Lilas" className="field" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Code postal">
                  <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="75001" className="field font-mono" />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Ville">
                    <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris" className="field" />
                  </Field>
                </div>
              </div>
              <Field label="Pays">
                <CountryCombobox value={countryCode} onChange={setCountryCode} />
              </Field>
            </div>
          </SectionCard>

          {mode === "edit" && card?.id && (
            <AdminCardPfsOrdersSection cardId={card.id} hasPfs={card.hasPfs || Boolean(card.pfsCustomerId)} />
          )}

          {mode === "edit" && card?.id && (
            <AdminCardOrderedProductsSection cardId={card.id} />
          )}

          {/* Marketplaces pleine largeur, 6 cases sur une ligne */}
          <SectionCard accent="emerald" title="D'où vient ce client ?" subtitle="plusieurs choix possibles">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {MARKETPLACES.map((mp) => {
                const checked = marketplaceValues[mp.key];
                return (
                  <label
                    key={mp.key}
                    className={`relative flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-all ${
                      checked
                        ? "border-2 border-text-primary bg-bg-secondary shadow-sm"
                        : "border border-border bg-bg-primary hover:border-border-strong"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => marketplaceSetters[mp.key](e.target.checked)}
                      className="absolute opacity-0 inset-0 cursor-pointer"
                    />
                    <span
                      className="w-9 h-9 rounded-xl text-white text-sm font-bold flex items-center justify-center shadow"
                      style={{ background: mp.gradient }}
                    >
                      {mp.initial}
                    </span>
                    <span className={`text-[12px] ${checked ? "font-semibold text-text-primary" : "font-medium text-text-secondary"}`}>
                      {mp.label}
                    </span>
                    {checked && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] flex items-center justify-center">✓</span>
                    )}
                  </label>
                );
              })}
            </div>
          </SectionCard>

          {/* Ligne 4 : Remise commande | Remise livraison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SectionCard
              accent="emerald"
              title="Remise sur commande"
              headerRight={
                <Toggle
                  active={orderDiscountEnabled}
                  onChange={setOrderDiscountEnabled}
                  color="emerald"
                />
              }
            >
              {orderDiscountEnabled ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={orderDiscountValue}
                      onChange={(e) => setOrderDiscountValue(e.target.value)}
                      placeholder="10"
                      className="field w-24 font-mono tabular-nums text-center text-lg font-bold"
                    />
                    <div className="inline-flex rounded-xl border border-border bg-bg-secondary p-0.5">
                      <button
                        type="button"
                        onClick={() => setOrderDiscountType("PERCENT")}
                        className={`px-4 h-10 rounded-lg text-sm font-semibold transition-colors ${
                          orderDiscountType === "PERCENT" ? "bg-bg-primary shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        %
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderDiscountType("AMOUNT")}
                        className={`px-4 h-10 rounded-lg text-sm font-semibold transition-colors ${
                          orderDiscountType === "AMOUNT" ? "bg-bg-primary shadow-sm text-text-primary" : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        €
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-3">Appliquée automatiquement sur chaque commande.</p>
                </>
              ) : (
                <p className="text-xs text-text-muted">Aucune remise sur commande pour ce client.</p>
              )}
            </SectionCard>

            <SectionCard
              accent="sky"
              title="Remise sur la livraison"
              headerRight={
                <Toggle
                  active={shippingEnabled}
                  onChange={setShippingEnabled}
                  color="sky"
                />
              }
            >
              {shippingEnabled ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex rounded-xl border border-border bg-bg-secondary p-0.5">
                      {(["OFFERTE", "PERCENT", "AMOUNT"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setShippingMode(m)}
                          className={`px-4 h-10 rounded-lg text-sm font-semibold transition-colors ${
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
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    {shippingMode === "OFFERTE" ? "Livraison gratuite pour ce client, tout le temps." : "Réduction appliquée sur les frais de livraison."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-text-muted">Aucune remise sur la livraison pour ce client.</p>
              )}
            </SectionCard>
          </div>

          {/* Suivi manuel */}
          <SectionCard accent="amber" title="Suivi manuel">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Date dernière commande">
                <input type="date" value={lastOrderAt} onChange={(e) => setLastOrderAt(e.target.value)} className="field" />
              </Field>
              <Field label="Date dernier message envoyé">
                <input type="date" value={lastMessageSentAt} onChange={(e) => setLastMessageSentAt(e.target.value)} className="field" />
              </Field>
            </div>
          </SectionCard>

          {/* Note personnelle */}
          <SectionCard accent="rose" title="Note personnelle">
            <textarea
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notes libres : produits attendus, préférences, contexte de la relation, à faire au prochain contact…"
              className="field resize-none w-full"
            />
          </SectionCard>

          {/* Footer */}
          <div className="bg-bg-primary rounded-2xl border border-border shadow-sm p-5 flex items-center justify-between gap-3">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-4 h-11 rounded-xl border border-rose-200 text-rose-600 text-sm font-semibold hover:bg-rose-50 disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
                Supprimer la fiche
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                className="px-5 h-11 rounded-xl border border-border text-text-secondary text-sm font-semibold hover:bg-bg-secondary disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-6 h-11 rounded-xl bg-gradient-to-br from-text-primary to-text-secondary text-white text-sm font-semibold shadow hover:opacity-90 disabled:opacity-50"
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
          padding: 0.625rem 0.875rem;
          border-radius: 0.75rem;
          border: 1px solid var(--border, #e2e8f0);
          background: var(--bg-primary, #fff);
          font-size: 14px;
          color: var(--text-primary, #0f172a);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .field:focus {
          border-color: var(--border-strong, #cbd5e1);
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08);
        }
      `}</style>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}

const ACCENT_MAP = {
  violet: { bar: "bg-violet-600", gradient: "from-violet-50" },
  sky: { bar: "bg-sky-500", gradient: "from-sky-50" },
  teal: { bar: "bg-teal-500", gradient: "from-teal-50" },
  emerald: { bar: "bg-emerald-500", gradient: "from-emerald-50" },
  amber: { bar: "bg-amber-500", gradient: "from-amber-50" },
  rose: { bar: "bg-rose-500", gradient: "from-rose-50" },
} as const;

type Accent = keyof typeof ACCENT_MAP;

function SectionCard({
  accent,
  title,
  subtitle,
  headerRight,
  children,
}: {
  accent: Accent;
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style = ACCENT_MAP[accent];
  return (
    <section className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className={`bg-gradient-to-r ${style.gradient} via-bg-primary to-bg-primary px-5 py-3.5 border-b border-border flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-1 h-5 rounded-full ${style.bar}`} />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">{title}</h3>
          {subtitle && <span className="text-[11px] text-text-muted normal-case tracking-normal font-normal">{subtitle}</span>}
        </div>
        {headerRight}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Toggle({
  active,
  onChange,
  color,
}: {
  active: boolean;
  onChange: (v: boolean) => void;
  color: "emerald" | "sky";
}) {
  const bg = active ? (color === "emerald" ? "bg-emerald-500" : "bg-sky-500") : "bg-slate-300";
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={`relative w-10 h-6 rounded-full transition-colors ${bg}`}
      aria-pressed={active}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${active ? "right-0.5" : "left-0.5"}`}
      />
    </button>
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
