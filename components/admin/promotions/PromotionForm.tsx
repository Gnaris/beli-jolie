"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createPromotion, updatePromotion } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";

interface PromotionData {
  id?: string;
  name: string;
  type: "CODE" | "AUTO";
  code: string;
  discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  discountValue: string;
  minOrderAmount: string;
  maxUses: string;
  maxUsesPerUser: string;
  firstOrderOnly: boolean;
  appliesToAll: boolean;
  startsAt: string;
  endsAt: string;
}

const DEFAULT_DATA: PromotionData = {
  name: "", type: "CODE", code: "", discountKind: "PERCENTAGE",
  discountValue: "", minOrderAmount: "", maxUses: "", maxUsesPerUser: "",
  firstOrderOnly: false, appliesToAll: true,
  startsAt: new Date().toISOString().slice(0, 16),
  endsAt: "",
};

/* ── Toggle switch ──────────────────────────── */
function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="group flex items-center gap-3 cursor-pointer select-none py-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
          checked ? "bg-bg-dark" : "bg-border-dark"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span className="text-sm font-body text-text-primary group-hover:text-text-secondary transition-colors">
        {label}
      </span>
    </label>
  );
}

/* ── Section wrapper ────────────────────────── */
function FormSection({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-border-light">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-bg-secondary text-text-secondary">
            {icon}
          </div>
          <div>
            <h3 className="font-heading font-semibold text-text-primary text-[0.95rem] leading-tight">{title}</h3>
            {description && (
              <p className="text-xs text-text-muted font-body mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

/* ── Input field ────────────────────────────── */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-[0.8rem] font-medium text-text-secondary font-body block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[0.7rem] text-text-muted font-body mt-1">{hint}</p>}
    </div>
  );
}

const inputClass = "w-full border border-border bg-bg-primary px-3.5 py-2.5 text-sm rounded-xl text-text-primary font-body placeholder:text-text-muted/50 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-bg-dark/10 focus:border-border-dark hover:border-border-dark";

/* ── Icons (inline SVG) ─────────────────────── */
const Icons = {
  tag: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
    </svg>
  ),
  percent: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  sparkles: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.7h6L15 12.4l1.9 5.7L12 14.3l-4.9 3.8L9 12.4 4.1 8.7h6z" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

/* ── Summary card ───────────────────────────── */
function PromotionSummary({ data }: { data: PromotionData }) {
  const discountLabel = useMemo(() => {
    if (data.discountKind === "FREE_SHIPPING") return "Livraison offerte";
    const val = parseFloat(data.discountValue) || 0;
    if (val === 0) return "—";
    if (data.discountKind === "PERCENTAGE") return `-${val}%`;
    return `-${val.toFixed(2)} €`;
  }, [data.discountKind, data.discountValue]);

  const formatDate = (d: string) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden sticky top-6">
      <div className="px-5 py-4 border-b border-border-light bg-bg-secondary/50">
        <h3 className="font-heading font-semibold text-text-primary text-sm">Résumé</h3>
      </div>

      <div className="p-5 space-y-5">
        {/* Promotion name & badge */}
        <div className="text-center pb-4 border-b border-border-light">
          <p className="font-heading font-bold text-text-primary text-lg leading-tight">
            {data.name || "Nouvelle promotion"}
          </p>
          <div className="flex items-center justify-center gap-2 mt-2.5">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[0.7rem] font-semibold font-body tracking-wide uppercase ${
              data.type === "CODE"
                ? "bg-accent-light text-accent-dark"
                : "bg-success/10 text-success"
            }`}>
              {data.type === "CODE" ? "Code promo" : "Automatique"}
            </span>
          </div>
          {data.type === "CODE" && data.code && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-bg-secondary rounded-xl border border-border-light">
              <span className="font-mono text-sm font-bold text-text-primary tracking-widest">{data.code}</span>
            </div>
          )}
        </div>

        {/* Discount display */}
        <div className="text-center">
          <div className={`inline-flex items-center justify-center min-w-[80px] px-5 py-3 rounded-2xl ${
            data.discountKind === "FREE_SHIPPING"
              ? "bg-success/10 text-success"
              : "bg-bg-dark text-white"
          }`}>
            <span className="font-heading font-bold text-xl">{discountLabel}</span>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-2.5 text-sm font-body">
          {data.minOrderAmount && parseFloat(data.minOrderAmount) > 0 && (
            <div className="flex items-center justify-between py-1.5">
              <span className="text-text-muted">Minimum</span>
              <span className="font-medium text-text-primary">{parseFloat(data.minOrderAmount).toFixed(2)} € HT</span>
            </div>
          )}

          <div className="flex items-center justify-between py-1.5">
            <span className="text-text-muted">Utilisations</span>
            <span className="font-medium text-text-primary">
              {data.maxUses ? `${data.maxUses} max` : "Illimitées"}
            </span>
          </div>

          <div className="flex items-center justify-between py-1.5">
            <span className="text-text-muted">Par client</span>
            <span className="font-medium text-text-primary">
              {data.maxUsesPerUser ? `${data.maxUsesPerUser} max` : "Illimité"}
            </span>
          </div>

          {data.firstOrderOnly && (
            <div className="flex items-center gap-2 py-1.5 text-warning">
              <span className="text-xs">1re commande uniquement</span>
            </div>
          )}

          <div className="border-t border-border-light pt-2.5 mt-1">
            <div className="flex items-center justify-between py-1">
              <span className="text-text-muted">Début</span>
              <span className="font-medium text-text-primary text-xs">{formatDate(data.startsAt)}</span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-text-muted">Fin</span>
              <span className="font-medium text-text-primary text-xs">{data.endsAt ? formatDate(data.endsAt) : "Pas de fin"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-1.5">
            <span className="text-text-muted">Produits</span>
            <span className="font-medium text-text-primary">
              {data.appliesToAll ? "Tous" : "Sélection"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Main form
   ═══════════════════════════════════════════════ */
export default function PromotionForm({ initial }: { initial?: Partial<PromotionData> & { id?: string } }) {
  const [data, setData] = useState<PromotionData>({ ...DEFAULT_DATA, ...initial });
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const router = useRouter();

  function update<K extends keyof PromotionData>(key: K, value: PromotionData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function generateCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    update("code", code);
  }

  function copyCode() {
    if (!data.code) return;
    navigator.clipboard.writeText(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const input = {
      name: data.name,
      type: data.type,
      code: data.type === "CODE" ? data.code : undefined,
      discountKind: data.discountKind,
      discountValue: parseFloat(data.discountValue) || 0,
      minOrderAmount: data.minOrderAmount ? parseFloat(data.minOrderAmount) : undefined,
      maxUses: data.maxUses ? parseInt(data.maxUses) : undefined,
      maxUsesPerUser: data.maxUsesPerUser ? parseInt(data.maxUsesPerUser) : undefined,
      firstOrderOnly: data.firstOrderOnly,
      appliesToAll: data.appliesToAll,
      startsAt: data.startsAt,
      endsAt: data.endsAt || undefined,
    };

    startTransition(async () => {
      const result = data.id
        ? await updatePromotion(data.id, input)
        : await createPromotion(input);

      if (result.success) {
        toast.success(data.id ? "Promotion mise à jour" : "Promotion créée");
        router.push("/admin/promotions");
      } else {
        toast.error(result.error || "Erreur");
      }
    });
  }

  const discountKindOptions = [
    { value: "PERCENTAGE" as const, label: "Pourcentage", shortLabel: "%" },
    { value: "FIXED_AMOUNT" as const, label: "Montant fixe", shortLabel: "€" },
    { value: "FREE_SHIPPING" as const, label: "Livraison offerte", shortLabel: "Livraison" },
  ];

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
      {/* ── Left column: form sections ── */}
      <div className="space-y-5">
        {/* ── Section 1: Informations ── */}
        <FormSection
          icon={Icons.tag}
          title="Informations"
          description="Nom et type de la promotion"
        >
          <Field label="Nom de la promotion">
            <input
              type="text"
              value={data.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Ex : Soldes été 2026, Bienvenue -10%…"
              className={inputClass}
            />
          </Field>

          <Field label="Type">
            <div className="flex gap-1.5 p-1 bg-bg-secondary rounded-xl">
              {(["CODE", "AUTO"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => update("type", t)}
                  className={`flex-1 px-4 py-2.5 text-sm font-body font-medium rounded-[10px] transition-all duration-200 ${
                    data.type === t
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {t === "CODE" ? "Code promo" : "Automatique"}
                </button>
              ))}
            </div>
            <p className="text-[0.7rem] text-text-muted font-body mt-1.5">
              {data.type === "CODE"
                ? "Le client saisit un code au moment de la commande."
                : "La remise s'applique automatiquement si les conditions sont remplies."}
            </p>
          </Field>

          {data.type === "CODE" && (
            <Field label="Code promotionnel">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={data.code}
                    onChange={(e) => update("code", e.target.value.toUpperCase())}
                    placeholder="EX : SUMMER2026"
                    className={`${inputClass} font-mono tracking-wider pr-10`}
                  />
                  {data.code && (
                    <button
                      type="button"
                      onClick={copyCode}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-all"
                      title="Copier"
                    >
                      {copied ? Icons.check : Icons.copy}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={generateCode}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-body font-medium bg-bg-secondary text-text-secondary rounded-xl border border-border hover:border-border-dark hover:bg-bg-tertiary transition-all"
                >
                  {Icons.sparkles}
                  Générer
                </button>
              </div>
            </Field>
          )}
        </FormSection>

        {/* ── Section 2: Remise ── */}
        <FormSection
          icon={Icons.percent}
          title="Remise"
          description="Montant et conditions de la réduction"
        >
          <Field label="Type de remise">
            <div className="flex gap-1.5 p-1 bg-bg-secondary rounded-xl">
              {discountKindOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("discountKind", opt.value)}
                  className={`flex-1 px-3 py-2.5 text-sm font-body font-medium rounded-[10px] transition-all duration-200 ${
                    data.discountKind === opt.value
                      ? "bg-bg-primary text-text-primary shadow-sm"
                      : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {opt.shortLabel}
                </button>
              ))}
            </div>
          </Field>

          {data.discountKind !== "FREE_SHIPPING" && (
            <Field
              label={data.discountKind === "PERCENTAGE" ? "Pourcentage de remise" : "Montant de la remise (€)"}
              hint={data.discountKind === "PERCENTAGE" ? "Entre 1 et 100" : "Montant en euros"}
            >
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max={data.discountKind === "PERCENTAGE" ? "100" : undefined}
                  step={data.discountKind === "PERCENTAGE" ? "1" : "0.01"}
                  value={data.discountValue}
                  onChange={(e) => update("discountValue", e.target.value)}
                  placeholder="0"
                  className={`${inputClass} pr-12`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted font-body font-medium">
                  {data.discountKind === "PERCENTAGE" ? "%" : "€"}
                </span>
              </div>
            </Field>
          )}

          <Field label="Commande minimum (HT)" hint="Laissez vide pour aucun minimum">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.01"
                value={data.minOrderAmount}
                onChange={(e) => update("minOrderAmount", e.target.value)}
                placeholder="Pas de minimum"
                className={`${inputClass} pr-12`}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted font-body">€</span>
            </div>
          </Field>
        </FormSection>

        {/* ── Section 3: Restrictions ── */}
        <FormSection
          icon={Icons.shield}
          title="Restrictions"
          description="Limites d'utilisation de la promotion"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Utilisations max" hint="Vide = illimité">
              <input
                type="number"
                min="0"
                value={data.maxUses}
                onChange={(e) => update("maxUses", e.target.value)}
                placeholder="Illimité"
                className={inputClass}
              />
            </Field>
            <Field label="Max par client" hint="Vide = illimité">
              <input
                type="number"
                min="0"
                value={data.maxUsesPerUser}
                onChange={(e) => update("maxUsesPerUser", e.target.value)}
                placeholder="Illimité"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="border-t border-border-light pt-4 space-y-2">
            <ToggleSwitch
              checked={data.firstOrderOnly}
              onChange={(v) => update("firstOrderOnly", v)}
              label="Première commande uniquement"
            />
            <ToggleSwitch
              checked={data.appliesToAll}
              onChange={(v) => update("appliesToAll", v)}
              label="S'applique à tous les produits"
            />
          </div>
        </FormSection>

        {/* ── Section 4: Dates ── */}
        <FormSection
          icon={Icons.calendar}
          title="Période de validité"
          description="Dates de début et fin de la promotion"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Début">
              <input
                type="datetime-local"
                value={data.startsAt}
                onChange={(e) => update("startsAt", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Fin (optionnel)">
              <input
                type="datetime-local"
                value={data.endsAt}
                onChange={(e) => update("endsAt", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          {!data.endsAt && (
            <p className="text-[0.7rem] text-text-muted font-body flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-success" />
              Sans date de fin, la promotion reste active indéfiniment.
            </p>
          )}
        </FormSection>

        {/* ── Submit ── */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!data.name.trim() || isPending}
            className="btn-primary btn-lg flex-1 justify-center"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Enregistrement…
              </span>
            ) : data.id ? (
              "Mettre à jour la promotion"
            ) : (
              "Créer la promotion"
            )}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/promotions")}
            className="btn-ghost"
          >
            Annuler
          </button>
        </div>
      </div>

      {/* ── Right column: live summary ── */}
      <div className="hidden lg:block">
        <PromotionSummary data={data} />
      </div>
    </form>
  );
}
