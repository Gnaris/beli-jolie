"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createPromotion, updatePromotion } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";
import { formatDiscountDisplay } from "@/lib/promotion-status";

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
function ToggleSwitch({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="group flex items-center gap-3 cursor-pointer select-none py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
          checked ? "bg-gradient-to-br from-emerald-600 to-emerald-700" : "bg-border-dark"
        }`}
      >
        <span
          className={`pointer-events-none absolute top-0.5 left-0.5 inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <div>
        <div className="text-[13.5px] font-body font-medium text-text-primary">{label}</div>
        {description && <div className="text-[11.5px] font-body text-text-muted mt-0.5">{description}</div>}
      </div>
    </label>
  );
}

/* ── Section wrapper ────────────────────────── */
function FormSection({ icon, title, description, children, accent = "neutral" }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  accent?: "neutral" | "dark";
}) {
  const iconClass = accent === "dark"
    ? "bg-gradient-to-br from-text-primary to-text-secondary text-white border border-text-primary"
    : "bg-bg-secondary text-text-primary border border-border-strong";
  return (
    <div className="bg-bg-primary border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-border-light bg-gradient-to-b from-bg-secondary/40 to-bg-primary">
        <div className="flex items-center gap-3">
          <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${iconClass}`}>
            {icon}
          </div>
          <div>
            <h3 className="font-heading font-bold text-text-primary text-[0.95rem] leading-tight">{title}</h3>
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
      <label className="text-[12px] font-body font-semibold text-text-secondary block mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-muted font-body mt-1.5">{hint}</p>}
    </div>
  );
}

const inputClass = "w-full border border-border bg-bg-primary px-3.5 py-2.5 text-sm rounded-xl text-text-primary font-body placeholder:text-text-muted/50 transition-all focus:outline-none focus:ring-4 focus:ring-text-primary/8 focus:border-text-primary hover:border-border-dark";

/* ── Icons (inline SVG) ─────────────────────── */
const Icons = {
  tag: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>
    </svg>
  ),
  percent: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  sparkles: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.7h6L15 12.4l1.9 5.7L12 14.3l-4.9 3.8L9 12.4 4.1 8.7h6z" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

/* ── Segmented control ───────────────────────── */
function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 p-1 bg-bg-secondary rounded-xl border border-border">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-2 text-sm font-body font-medium rounded-[10px] transition-all ${
            value === opt.value
              ? "bg-bg-primary text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ── Preview ticket (colonne droite, sticky) ───────────────────────────── */
function PromotionPreview({ data }: { data: PromotionData }) {
  const value = parseFloat(data.discountValue) || 0;
  const display = useMemo(
    () => formatDiscountDisplay(data.discountKind, value),
    [data.discountKind, value],
  );

  const formatDate = (d: string) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  return (
    <aside className="lg:sticky lg:top-6 bg-bg-primary border border-border rounded-3xl shadow-sm overflow-hidden">
      {/* Header sombre */}
      <div className="px-5 py-3 bg-gradient-to-br from-text-primary to-text-secondary text-white flex items-center gap-2">
        <span className="relative inline-flex w-1.5 h-1.5">
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
          <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[11px] font-body font-bold uppercase tracking-[0.18em]">Aperçu en direct</span>
      </div>

      {/* Ticket géant */}
      <div className="relative mx-5 my-5 rounded-2xl overflow-hidden bg-gradient-to-br from-text-primary to-text-secondary text-white text-center px-5 py-6 shadow-lg">
        {/* Encoches latérales */}
        <span className="absolute left-[-11px] top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-bg-primary" />
        <span className="absolute right-[-11px] top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-bg-primary" />

        <div className="text-[10px] font-body font-bold uppercase tracking-[0.24em] opacity-80 mb-2 truncate">
          {data.name || "Nouvelle promotion"}
        </div>

        {display.isText ? (
          <>
            <div className="font-heading text-4xl font-bold leading-none">{display.main}</div>
            <div className="text-[11px] font-body font-bold uppercase tracking-[0.2em] opacity-85 mt-1.5">{display.unit}</div>
          </>
        ) : (
          <>
            <div className="font-heading text-5xl font-bold leading-none tabular-nums">{display.main}</div>
            <div className="text-[11px] font-body font-bold uppercase tracking-[0.2em] opacity-85 mt-2">{display.unit}</div>
          </>
        )}

        {data.type === "CODE" && data.code && (
          <>
            <div className="my-3.5 h-px" style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 5px, transparent 5px 10px)" }} />
            <div className="inline-block font-mono text-[15px] font-bold tracking-[0.2em] bg-white/15 backdrop-blur px-3.5 py-2 rounded-lg border border-dashed border-white/40">
              {data.code}
            </div>
          </>
        )}
      </div>

      {/* Résumé */}
      <div className="px-5 pb-5 space-y-2 text-[13px] font-body">
        <div className="flex justify-center gap-1.5 pb-3">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10.5px] font-body font-bold uppercase tracking-[0.05em] ${
            data.type === "CODE"
              ? "bg-gradient-to-br from-text-primary to-text-secondary text-white"
              : "bg-bg-primary text-text-primary border border-border-strong"
          }`}>
            {data.type === "CODE" ? "Code promo" : "Remise automatique"}
          </span>
        </div>

        {data.minOrderAmount && parseFloat(data.minOrderAmount) > 0 && (
          <div className="flex items-center justify-between py-1.5 border-b border-border-light">
            <span className="text-text-muted">Minimum</span>
            <span className="font-medium text-text-primary tabular-nums">{parseFloat(data.minOrderAmount).toFixed(2)} € HT</span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5 border-b border-border-light">
          <span className="text-text-muted">Utilisations max</span>
          <span className="font-medium text-text-primary tabular-nums">{data.maxUses || "Illimitées"}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border-light">
          <span className="text-text-muted">Par client</span>
          <span className="font-medium text-text-primary tabular-nums">{data.maxUsesPerUser ? `${data.maxUsesPerUser} max` : "Illimité"}</span>
        </div>
        {data.firstOrderOnly && (
          <div className="flex items-center justify-between py-1.5 border-b border-border-light">
            <span className="text-text-muted">1<sup>re</sup> commande</span>
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
              {Icons.check} Oui
            </span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5 border-b border-border-light">
          <span className="text-text-muted">Produits</span>
          <span className="font-medium text-text-primary">{data.appliesToAll ? "Tous" : "Sélection"}</span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-border-light">
          <span className="text-text-muted">Début</span>
          <span className="font-medium text-text-primary text-[11.5px]">{formatDate(data.startsAt)}</span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-text-muted">Fin</span>
          <span className="font-medium text-text-primary text-[11.5px]">{data.endsAt ? formatDate(data.endsAt) : "Sans fin"}</span>
        </div>

        {data.name.trim() && (data.discountKind === "FREE_SHIPPING" || parseFloat(data.discountValue) > 0) && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-[12px] text-emerald-800 font-medium flex items-start gap-2">
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
            <div>Conditions remplies. La promotion sera active dès sa création.</div>
          </div>
        )}
      </div>
    </aside>
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

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
      {/* ── Colonne formulaire ── */}
      <div className="space-y-4">
        {/* Section 1 : Informations */}
        <FormSection
          icon={Icons.tag}
          title="Informations"
          description="Le nom sert à vous repérer, il n'est pas visible par le client."
          accent="dark"
        >
          <Field label="Nom interne">
            <input
              type="text"
              value={data.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Ex : Soldes été 2026, Bienvenue -10%…"
              className={inputClass}
            />
          </Field>

          <Field
            label="Type de promotion"
            hint={data.type === "CODE"
              ? "Le client saisit un code au moment de la commande."
              : "La remise s'applique automatiquement si les conditions sont remplies."}
          >
            <Segmented<"CODE" | "AUTO">
              value={data.type}
              onChange={(v) => update("type", v)}
              options={[
                { value: "CODE", label: "Code promo" },
                { value: "AUTO", label: "Automatique" },
              ]}
            />
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

        {/* Section 2 : Remise */}
        <FormSection
          icon={Icons.percent}
          title="Remise"
          description="Ce que le client économise sur sa commande."
        >
          <Field label="Type de remise">
            <Segmented<"PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING">
              value={data.discountKind}
              onChange={(v) => update("discountKind", v)}
              options={[
                { value: "PERCENTAGE",    label: "Pourcentage %" },
                { value: "FIXED_AMOUNT",  label: "Montant fixe €" },
                { value: "FREE_SHIPPING", label: "Livraison offerte" },
              ]}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.discountKind !== "FREE_SHIPPING" && (
              <Field
                label={data.discountKind === "PERCENTAGE" ? "Pourcentage de remise" : "Montant de la remise"}
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
                    className={`${inputClass} pr-10 tabular-nums`}
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
                  className={`${inputClass} pr-10 tabular-nums`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-text-muted font-body">€</span>
              </div>
            </Field>
          </div>
        </FormSection>

        {/* Section 3 : Restrictions */}
        <FormSection
          icon={Icons.shield}
          title="Restrictions"
          description="Limitez qui peut l'utiliser et combien de fois."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Utilisations totales" hint="Vide = illimité">
              <input
                type="number"
                min="0"
                value={data.maxUses}
                onChange={(e) => update("maxUses", e.target.value)}
                placeholder="Illimité"
                className={`${inputClass} tabular-nums`}
              />
            </Field>
            <Field label="Max par client" hint="Vide = illimité">
              <input
                type="number"
                min="0"
                value={data.maxUsesPerUser}
                onChange={(e) => update("maxUsesPerUser", e.target.value)}
                placeholder="Illimité"
                className={`${inputClass} tabular-nums`}
              />
            </Field>
          </div>

          <div className="border-t border-border-light pt-4 space-y-1">
            <ToggleSwitch
              checked={data.firstOrderOnly}
              onChange={(v) => update("firstOrderOnly", v)}
              label="Première commande uniquement"
              description="Seuls les nouveaux clients pourront l'utiliser"
            />
            <ToggleSwitch
              checked={data.appliesToAll}
              onChange={(v) => update("appliesToAll", v)}
              label="S'applique à tous les produits"
              description="Sinon, choisissez une sélection ciblée"
            />
          </div>
        </FormSection>

        {/* Section 4 : Dates */}
        <FormSection
          icon={Icons.calendar}
          title="Période de validité"
          description="Quand la promotion démarre et quand elle s'arrête."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date de début">
              <input
                type="datetime-local"
                value={data.startsAt}
                onChange={(e) => update("startsAt", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Date de fin (facultatif)">
              <input
                type="datetime-local"
                value={data.endsAt}
                onChange={(e) => update("endsAt", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          {!data.endsAt && (
            <p className="text-[11.5px] text-text-muted font-body flex items-center gap-2 mt-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Sans date de fin, la promotion reste active indéfiniment.
            </p>
          )}
        </FormSection>

        {/* Submit */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!data.name.trim() || isPending}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-br from-text-primary to-text-secondary text-white text-sm font-body font-semibold shadow-md hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-1"
          >
            {isPending ? (
              <>
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Enregistrement…
              </>
            ) : (
              <>
                {Icons.check}
                {data.id ? "Mettre à jour la promotion" : "Créer la promotion"}
              </>
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

      {/* ── Colonne aperçu ── */}
      <div className="hidden xl:block">
        <PromotionPreview data={data} />
      </div>
    </form>
  );
}
