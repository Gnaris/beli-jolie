"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  saveShippingAddress,
  deleteShippingAddress,
} from "@/app/actions/client/cart";
import { updateBillingInfo } from "@/app/actions/client/billing";
import { computeShippingCascade } from "@/lib/shipping-cascade";
import type {
  WizardAddress,
  WizardBillingInfo,
  WizardCarrier,
  WizardClientDiscount,
  WizardShippingPromo,
  DeliveryMode,
  PrivateSubMode,
  WizardPickupInfo,
  WizardMergeCandidate,
} from "./types";

/**
 * Étape 2 — Facturation + Livraison. UI refaite pour matcher la maquette :
 * 4 tuiles de mode de livraison, formulaire facturation, sous-formulaire
 * spécifique à chaque mode (adresse+transporteur, retrait, propre, fusion).
 */
export default function Step2DeliveryContent({
  billingInfo,
  onBillingChange,
  addresses,
  onAddressesChange,
  selectedAddrId,
  onSelectedAddrChange,
  deliveryMode,
  onDeliveryModeChange,
  carriers,
  carriersLoading,
  carriersError,
  noCarrierConfigured,
  selectedCarrierId,
  onSelectedCarrierChange,
  privateMode,
  onPrivateModeChange,
  privateCarrierEmail,
  onPrivateCarrierEmailChange,
  privateCarrierPhone,
  onPrivateCarrierPhoneChange,
  bordereauName,
  bordereauUploading,
  onBordereauUpload,
  onBordereauClear,
  selectedMergeOrderId,
  onSelectedMergeOrderChange,
  pickupInfo,
  mergeCandidates,
  clientDiscount,
  shippingPromos,
  minOrderHT,
  subtotalHT,
}: {
  billingInfo: WizardBillingInfo;
  onBillingChange: (b: WizardBillingInfo) => void;
  addresses: WizardAddress[];
  onAddressesChange: (a: WizardAddress[]) => void;
  selectedAddrId: string | null;
  onSelectedAddrChange: (id: string | null) => void;
  deliveryMode: DeliveryMode;
  onDeliveryModeChange: (m: DeliveryMode) => void;
  carriers: WizardCarrier[];
  carriersLoading: boolean;
  carriersError: string;
  noCarrierConfigured: boolean;
  selectedCarrierId: string | null;
  onSelectedCarrierChange: (id: string | null) => void;
  privateMode: PrivateSubMode;
  onPrivateModeChange: (m: PrivateSubMode) => void;
  privateCarrierEmail: string;
  onPrivateCarrierEmailChange: (v: string) => void;
  privateCarrierPhone: string;
  onPrivateCarrierPhoneChange: (v: string) => void;
  bordereauName: string;
  bordereauUploading: boolean;
  onBordereauUpload: (file: File) => Promise<void>;
  onBordereauClear: () => void;
  selectedMergeOrderId: string | null;
  onSelectedMergeOrderChange: (id: string | null) => void;
  pickupInfo: WizardPickupInfo | null;
  mergeCandidates: WizardMergeCandidate[];
  clientDiscount: WizardClientDiscount;
  /** Promos AUTO ciblant la livraison (SHIPPING) — pour cascade par transporteur. */
  shippingPromos: WizardShippingPromo[];
  /** Minimum d'achat HT paramétré par l'admin (0 = pas de minimum). */
  minOrderHT: number;
  /** Sous-total HT courant du panier (après remises produit). */
  subtotalHT: number;
}) {
  const t = useTranslations("checkout");
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");

  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressDraft, setAddressDraft] = useState<WizardAddress | null>(null);
  const [isSavingBilling, setIsSavingBilling] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);

  async function handleSaveBilling() {
    setIsSavingBilling(true);
    try {
      await updateBillingInfo({
        firstName:         billingInfo.firstName,
        lastName:          billingInfo.lastName,
        company:           billingInfo.company,
        phone:             billingInfo.phone,
        vatNumber:         billingInfo.vatNumber,
        addressStreet:     billingInfo.address1,
        addressComplement: billingInfo.address2,
        addressZip:        billingInfo.zipCode,
        addressCity:       billingInfo.city,
        addressCountry:    billingInfo.country,
      });
    } finally {
      setIsSavingBilling(false);
    }
  }

  async function handleSaveAddress(a: WizardAddress) {
    setSavingAddr(true);
    try {
      const saved = (await saveShippingAddress({
        label:     `${a.city} — ${a.address1}`.slice(0, 50),
        firstName: a.firstName,
        lastName:  a.lastName,
        company:   a.company ?? "",
        address1:  a.address1,
        address2:  a.address2 ?? "",
        zipCode:   a.zipCode,
        city:      a.city,
        country:   a.country,
        phone:     a.phone ?? "",
        isDefault: a.isDefault,
      })) as WizardAddress;
      onAddressesChange([...addresses.filter((x) => x.id !== saved.id), saved]);
      onSelectedAddrChange(saved.id);
      setAddressFormOpen(false);
      setAddressDraft(null);
    } finally {
      setSavingAddr(false);
    }
  }

  async function handleDeleteAddress(id: string) {
    await deleteShippingAddress(id);
    onAddressesChange(addresses.filter((a) => a.id !== id));
    if (selectedAddrId === id) onSelectedAddrChange(null);
  }

  // La tuile « Fusion » est TOUJOURS visible pour que la cliente sache que
  // l'option existe. Si aucune commande n'est éligible, la tuile est désactivée
  // et un message explicatif s'affiche à la place du listing.
  const hasMergeCandidates = mergeCandidates.length > 0;

  // Minimum d'achat : géré à l'étape 2 (pas à l'étape 1) car le mode « merge »
  // (ajout à une commande existante) l'ignore — l'admin regroupera avec une
  // commande parente qui a déjà passé le seuil.
  const isMergeMode = deliveryMode === "merge";
  const missingToMin = Math.max(0, minOrderHT - subtotalHT);
  const minReached = minOrderHT <= 0 || subtotalHT >= minOrderHT;
  const showMinBanner = minOrderHT > 0 && (!minReached || isMergeMode);

  const tCart2 = useTranslations("cart");

  return (
    <div className="space-y-5">
      {/* Bandeau minimum d'achat */}
      {showMinBanner && (
        <div
          className={`rounded-2xl border p-4 md:p-5 flex items-center gap-3 ${
            isMergeMode
              ? "bg-sky-50 border-sky-200 text-sky-800"
              : minReached
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          <div className="w-9 h-9 rounded-full bg-white border border-current/20 flex items-center justify-center shrink-0">
            {isMergeMode ? "ℹ" : minReached ? "✓" : "!"}
          </div>
          <div className="text-sm flex-1">
            {isMergeMode
              ? tCart2("minIgnoredForMerge", { min: minOrderHT.toFixed(2) })
              : minReached
                ? tCart2("minReachedLong", { min: minOrderHT.toFixed(2) })
                : (
                  <>
                    <div>
                      {tCart2("minMissingLong", {
                        min:     minOrderHT.toFixed(2),
                        missing: missingToMin.toFixed(2),
                      })}
                    </div>
                    {hasMergeCandidates && (
                      <div className="text-xs mt-1 opacity-80">
                        💡 {tCart2("minIgnoreHintForMerge")}
                      </div>
                    )}
                  </>
                )}
          </div>
        </div>
      )}

      {/* Bloc Facturation */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="flex items-baseline justify-between mb-1 gap-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            {t("billingTitle")}
          </div>
          <button
            type="button"
            onClick={handleSaveBilling}
            disabled={isSavingBilling}
            className="text-xs text-slate-500 hover:text-slate-900 font-semibold disabled:opacity-50"
          >
            {isSavingBilling ? tCommon("saving") : tCommon("save")}
          </button>
        </div>
        <h2 className="font-heading text-lg md:text-xl font-semibold mb-5 text-slate-900">
          {t("billingTitle")}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label={t("firstName")}
            value={billingInfo.firstName}
            onChange={(v) => onBillingChange({ ...billingInfo, firstName: v })}
          />
          <Field
            label={t("lastName")}
            value={billingInfo.lastName}
            onChange={(v) => onBillingChange({ ...billingInfo, lastName: v })}
          />
          <Field
            className="sm:col-span-2"
            label={t("company")}
            value={billingInfo.company}
            onChange={(v) => onBillingChange({ ...billingInfo, company: v })}
          />
          <Field
            label={t("vatNumber")}
            value={billingInfo.vatNumber}
            onChange={(v) => onBillingChange({ ...billingInfo, vatNumber: v })}
          />
          <Field
            label={t("phone")}
            value={billingInfo.phone}
            onChange={(v) => onBillingChange({ ...billingInfo, phone: v })}
          />
          <Field
            className="sm:col-span-2"
            label={t("address")}
            value={billingInfo.address1}
            onChange={(v) => onBillingChange({ ...billingInfo, address1: v })}
          />
          <Field
            label={t("zipCode")}
            value={billingInfo.zipCode}
            onChange={(v) => onBillingChange({ ...billingInfo, zipCode: v })}
          />
          <Field
            label={t("city")}
            value={billingInfo.city}
            onChange={(v) => onBillingChange({ ...billingInfo, city: v })}
          />
          <Field
            className="sm:col-span-2"
            label={t("country")}
            value={billingInfo.country}
            onChange={(v) => onBillingChange({ ...billingInfo, country: v })}
          />
        </div>
      </section>

      {/* Bloc Mode de livraison */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <div className="mb-5">
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-1">
            {t("deliveryModeTitle")}
          </div>
          <h2 className="font-heading text-lg md:text-xl font-semibold text-slate-900">
            {t("deliveryModeTitle")}
          </h2>
        </div>

        {/* Tuiles de mode */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <ModeTile
            active={deliveryMode === "delivery"}
            onClick={() => onDeliveryModeChange("delivery")}
            icon="🚚"
            title={t("modeDelivery")}
            desc={t("modeDeliveryDesc")}
          />
          <ModeTile
            active={deliveryMode === "pickup"}
            onClick={() => onDeliveryModeChange("pickup")}
            icon="🏬"
            title={t("modePickup")}
            desc={t("modePickupDesc")}
          />
          <ModeTile
            active={deliveryMode === "private"}
            onClick={() => onDeliveryModeChange("private")}
            icon="🚛"
            title={t("modePrivate")}
            desc={t("modePrivateDesc")}
          />
          <ModeTile
            active={deliveryMode === "merge"}
            onClick={() => hasMergeCandidates && onDeliveryModeChange("merge")}
            icon="➕"
            title={t("modeMerge")}
            desc={hasMergeCandidates ? t("modeMergeDesc") : t("modeMergeUnavailable")}
            disabled={!hasMergeCandidates}
          />
        </div>

        {/* Contenu selon mode */}
        {deliveryMode === "delivery" && (
          <div className="space-y-6">
            {/* Adresse de livraison */}
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm font-semibold text-slate-900">
                  {t("shippingAddressTitle")}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAddressDraft({
                      id: "",
                      label: "",
                      firstName: billingInfo.firstName,
                      lastName: billingInfo.lastName,
                      company: billingInfo.company,
                      address1: "",
                      address2: "",
                      zipCode: "",
                      city: "",
                      country: billingInfo.country || "FR",
                      phone: billingInfo.phone,
                      isDefault: addresses.length === 0,
                    });
                    setAddressFormOpen(true);
                  }}
                  className="text-sm text-slate-600 hover:text-slate-900 font-medium"
                >
                  + {t("newAddress")}
                </button>
              </div>

              <div className="space-y-3">
                {addresses.map((a) => (
                  <RadioCard
                    key={a.id}
                    selected={selectedAddrId === a.id}
                    onClick={() => onSelectedAddrChange(a.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-900">
                          {a.label || `${a.firstName} ${a.lastName}`}
                        </span>
                        {a.isDefault && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                            {t("defaultBadge")}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        {a.address1}
                        {a.address2 ? `, ${a.address2}` : ""}, {a.zipCode} {a.city} — {a.country}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteAddress(a.id);
                      }}
                      className="text-xs text-slate-400 hover:text-red-600 font-medium"
                    >
                      {tCommon("delete")}
                    </button>
                  </RadioCard>
                ))}

                {addressFormOpen && addressDraft && (
                  <AddressEditForm
                    draft={addressDraft}
                    onDraftChange={setAddressDraft}
                    onSave={() => handleSaveAddress(addressDraft)}
                    onCancel={() => {
                      setAddressFormOpen(false);
                      setAddressDraft(null);
                    }}
                    saving={savingAddr}
                  />
                )}

                {addresses.length === 0 && !addressFormOpen && (
                  <p className="text-sm text-slate-500 text-center py-4">
                    {t("noAddress")}
                  </p>
                )}
              </div>
            </div>

            <div className="h-px bg-slate-100" />

            {/* Transporteurs */}
            <div>
              <div className="text-sm font-semibold text-slate-900 mb-3">
                {t("deliveryModeTitle")}
              </div>

              {!selectedAddrId && (
                <p className="text-sm text-slate-500 text-center py-4">
                  {t("selectAddressFirst")}
                </p>
              )}

              {selectedAddrId && carriersLoading && (
                <p className="text-sm text-slate-500 text-center py-4">
                  {t("carriersLoadingShort")}
                </p>
              )}

              {selectedAddrId && !carriersLoading && carriersError && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">
                  {carriersError}
                </div>
              )}

              {selectedAddrId && !carriersLoading && !carriersError && carriers.length === 0 && (
                <div
                  className={`rounded-xl text-sm p-4 ${
                    noCarrierConfigured
                      ? "bg-amber-50 border border-amber-200 text-amber-900"
                      : "bg-slate-50 border border-slate-200 text-slate-500 text-center"
                  }`}
                >
                  {noCarrierConfigured ? t("noCarriersConfigured") : t("noCarriersAvailable")}
                </div>
              )}

              <div className="space-y-3">
                {carriers.map((c) => {
                  const cap = clientDiscount.freeShippingMaxPrice;
                  const freeEligible =
                    clientDiscount.freeShipping && (cap == null || c.price <= cap);
                  const cascade = computeShippingCascade({
                    carrierPrice: c.price,
                    shippingPromos,
                    freeShippingActive: freeEligible,
                    clientShippingDiscountType: clientDiscount.shippingDiscountType,
                    clientShippingDiscountValue: clientDiscount.shippingDiscountValue,
                  });
                  const hasReduction = cascade.totalSaved > 0.005;
                  return (
                    <RadioCard
                      key={c.id}
                      selected={selectedCarrierId === c.id}
                      onClick={() => onSelectedCarrierChange(c.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-sm text-slate-900">{c.name}</div>
                            {c.delay && (
                              <div className="text-xs text-slate-500 mt-0.5">{c.delay}</div>
                            )}
                          </div>
                          {/* Cascade prix : initial barré → chaque flèche promo/remise → prix final */}
                          <div className="text-right shrink-0">
                            <div className="flex items-baseline gap-1 flex-wrap justify-end">
                              {hasReduction && (
                                <span className="font-heading font-semibold text-xs text-slate-400 line-through tabular-nums">
                                  {c.price.toFixed(2)} €
                                </span>
                              )}
                              {cascade.trace.map((line, idx) => (
                                <span key={idx} className="inline-flex flex-col items-center leading-[1]">
                                  <span className="text-[4px] uppercase tracking-wider text-slate-400 font-medium whitespace-nowrap">
                                    {line.kind === "client" ? "Remise" : "Promo"}
                                  </span>
                                  {line.percent != null && (
                                    <span className="text-[4px] text-slate-400 whitespace-nowrap">
                                      -{line.percent}%
                                    </span>
                                  )}
                                  <span className="text-[9px] text-slate-400 leading-none">→</span>
                                </span>
                              ))}
                              {cascade.isFree ? (
                                <span className="font-semibold text-sm text-emerald-700">
                                  {t("carrierFree")}
                                </span>
                              ) : (
                                <span className={`font-heading font-semibold text-sm tabular-nums ${
                                  hasReduction ? "text-emerald-700" : "text-slate-900"
                                }`}>
                                  {cascade.finalPrice.toFixed(2)} €
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </RadioCard>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {deliveryMode === "pickup" && (
          <PickupPanel pickupInfo={pickupInfo} />
        )}

        {deliveryMode === "private" && (
          <PrivatePanel
            pickupInfo={pickupInfo}
            privateMode={privateMode}
            onPrivateModeChange={onPrivateModeChange}
            email={privateCarrierEmail}
            onEmailChange={onPrivateCarrierEmailChange}
            phone={privateCarrierPhone}
            onPhoneChange={onPrivateCarrierPhoneChange}
            bordereauName={bordereauName}
            uploading={bordereauUploading}
            onUpload={onBordereauUpload}
            onClear={onBordereauClear}
          />
        )}

        {deliveryMode === "merge" && (
          <MergePanel
            candidates={mergeCandidates}
            selectedId={selectedMergeOrderId}
            onSelect={onSelectedMergeOrderChange}
          />
        )}
      </section>
    </div>
  );
}

/* ═══ Sous-composants ═══ */

function Field({
  label,
  value,
  onChange,
  className,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
      />
    </div>
  );
}

function ModeTile({
  active,
  onClick,
  icon,
  title,
  desc,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-4 rounded-2xl border transition-all flex flex-col gap-2 ${
        disabled
          ? "border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed"
          : active
            ? "border-slate-900 bg-slate-50 shadow-[0_0_0_3px_rgba(15,23,42,0.06)]"
            : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
          disabled
            ? "bg-slate-100 text-slate-400"
            : active
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-500"
        }`}
      >
        {icon}
      </div>
      <div className={`font-semibold text-sm leading-tight ${disabled ? "text-slate-500" : "text-slate-900"}`}>
        {title}
      </div>
      <div className="text-xs text-slate-500 leading-snug">{desc}</div>
    </button>
  );
}

function RadioCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${
        selected
          ? "border-slate-900 bg-slate-50 shadow-[0_0_0_3px_rgba(15,23,42,0.06)]"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 relative ${
          selected ? "border-slate-900" : "border-slate-300"
        }`}
        aria-hidden="true"
      >
        {selected && (
          <span className="absolute inset-[3px] rounded-full bg-slate-900" />
        )}
      </span>
      {children}
    </div>
  );
}

function AddressEditForm({
  draft,
  onDraftChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: WizardAddress;
  onDraftChange: (d: WizardAddress) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  return (
    <div className="rounded-2xl border border-slate-300 bg-slate-50 p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t("firstName")} value={draft.firstName} onChange={(v) => onDraftChange({ ...draft, firstName: v })} />
        <Field label={t("lastName")} value={draft.lastName} onChange={(v) => onDraftChange({ ...draft, lastName: v })} />
        <Field className="sm:col-span-2" label={t("company")} value={draft.company ?? ""} onChange={(v) => onDraftChange({ ...draft, company: v })} />
        <Field className="sm:col-span-2" label={t("address")} value={draft.address1} onChange={(v) => onDraftChange({ ...draft, address1: v })} />
        <Field className="sm:col-span-2" label={t("addressComplement")} value={draft.address2 ?? ""} onChange={(v) => onDraftChange({ ...draft, address2: v })} />
        <Field label={t("zipCode")} value={draft.zipCode} onChange={(v) => onDraftChange({ ...draft, zipCode: v })} />
        <Field label={t("city")} value={draft.city} onChange={(v) => onDraftChange({ ...draft, city: v })} />
        <Field label={t("country")} value={draft.country} onChange={(v) => onDraftChange({ ...draft, country: v })} />
        <Field label={t("phone")} value={draft.phone ?? ""} onChange={(v) => onDraftChange({ ...draft, phone: v })} />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm text-slate-600 hover:text-slate-900 hover:bg-white"
        >
          {tCommon("cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? tCommon("saving") : tCommon("save")}
        </button>
      </div>
    </div>
  );
}

function PickupPanel({ pickupInfo }: { pickupInfo: WizardPickupInfo | null }) {
  const t = useTranslations("checkout");
  if (!pickupInfo?.store) {
    return (
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-900">{t("pickupFreeTitle")}</p>
        <p className="text-xs text-slate-500 mt-1">{t("pickupFreeDesc")}</p>
      </div>
    );
  }
  const { store, schedule } = pickupInfo;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 text-lg">
            🏬
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900">{store.name}</p>
            <p className="text-xs text-slate-600 mt-1">{store.address}</p>
            <p className="text-xs text-slate-600">
              {store.postalCode} {store.city} — {store.country}
            </p>
            {store.phone && <p className="text-xs text-slate-600 mt-1">{store.phone}</p>}
            {schedule && schedule.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                  {t("pickupOpeningHours")}
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {schedule.map((d) => (
                    <li key={d.day} className="flex justify-between gap-3">
                      <span className="text-slate-500">{d.day}</span>
                      <span className={`font-medium ${d.hours === "Fermé" ? "text-slate-400" : "text-slate-900"}`}>
                        {d.hours}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-slate-600 mt-3">{t("pickupFreeDesc")}</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        {t("pickupNoShippingFees")}
      </div>
    </div>
  );
}

function PrivatePanel({
  pickupInfo,
  privateMode,
  onPrivateModeChange,
  email,
  onEmailChange,
  phone,
  onPhoneChange,
  bordereauName,
  uploading,
  onUpload,
  onClear,
}: {
  pickupInfo: WizardPickupInfo | null;
  privateMode: PrivateSubMode;
  onPrivateModeChange: (m: PrivateSubMode) => void;
  email: string;
  onEmailChange: (v: string) => void;
  phone: string;
  onPhoneChange: (v: string) => void;
  bordereauName: string;
  uploading: boolean;
  onUpload: (f: File) => Promise<void>;
  onClear: () => void;
}) {
  const t = useTranslations("checkout");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3">
        {t("privateSelfDesc")}
      </div>

      {pickupInfo?.store && (
        <div className="rounded-2xl bg-white border border-slate-200 p-4">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
            {t("privateSenderAddressLabel")}
          </p>
          <p className="text-sm font-semibold text-slate-900">{pickupInfo.store.name}</p>
          <p className="text-xs text-slate-600 mt-0.5">{pickupInfo.store.address}</p>
          <p className="text-xs text-slate-600">
            {pickupInfo.store.postalCode} {pickupInfo.store.city} — {pickupInfo.store.country}
          </p>
          {pickupInfo.store.phone && (
            <p className="text-xs text-slate-600 mt-1">
              {t("phone")} : {pickupInfo.store.phone}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RadioCard
          selected={privateMode === "contact"}
          onClick={() => onPrivateModeChange("contact")}
        >
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-slate-900">
              {t("privateContactMode")}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{t("privateContactDesc")}</div>
          </div>
        </RadioCard>
        <RadioCard
          selected={privateMode === "bordereau"}
          onClick={() => onPrivateModeChange("bordereau")}
        >
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-slate-900">
              {t("privateBordereauMode")}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{t("privateBordereauDesc")}</div>
          </div>
        </RadioCard>
      </div>

      {privateMode === "contact" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label={t("privateContactEmail")}
            value={email}
            onChange={onEmailChange}
            type="email"
            placeholder="contact@transporteur.com"
          />
          <Field
            label={t("privateContactPhone")}
            value={phone}
            onChange={onPhoneChange}
            placeholder="06 XX XX XX XX"
          />
        </div>
      )}

      {privateMode === "bordereau" && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            {t("privateBordereauFileLabel")}
          </label>
          <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            {bordereauName ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-slate-900 truncate">{bordereauName}</span>
                </div>
                <button
                  type="button"
                  onClick={onClear}
                  className="text-xs text-slate-500 hover:text-red-600 font-medium"
                >
                  {tCommon("delete")}
                </button>
              </div>
            ) : (
              <label className="cursor-pointer flex flex-col items-center gap-2">
                <div className="text-3xl">📎</div>
                <div className="text-sm font-semibold text-slate-700">
                  {uploading ? tCommon("saving") : t("privateBordereauDrop")}
                </div>
                <div className="text-xs text-slate-500">{t("privateBordereauFormats")}</div>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                  }}
                  className="sr-only"
                  disabled={uploading}
                />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MergePanel({
  candidates,
  selectedId,
  onSelect,
}: {
  candidates: WizardMergeCandidate[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useTranslations("checkout");
  const tCart = useTranslations("cart");
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-sky-50 border border-sky-200 text-sky-800 text-sm px-4 py-3">
        {t("mergeInfoBanner")}
      </div>
      {candidates.map((o) => (
        <RadioCard
          key={o.id}
          selected={selectedId === o.id}
          onClick={() => onSelect(o.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="font-semibold text-sm text-slate-900">
                {t("mergeOrderLabel", { number: o.orderNumber })}
              </span>
              <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">
                {t("statusPending")}
              </span>
            </div>
            <p className="text-sm text-slate-600 mt-1">
              {new Date(o.createdAtIso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
              {" · "}{o.totalTTC.toFixed(2)} € TTC · {o.itemsCount}{" "}
              {o.itemsCount > 1 ? tCart("linesOrdered_plural") : tCart("linesOrdered")}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {t("mergeDeliveryPrevue")} : {o.carrierName} → {o.shipAddressShort}
            </p>
          </div>
        </RadioCard>
      ))}
      <p className="text-xs text-slate-500">{t("mergeExplainer")}</p>
    </div>
  );
}
