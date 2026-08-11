"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPromotion, updatePromotion, getPromotionTargets } from "@/app/actions/admin/promotions";
import { useToast } from "@/components/ui/Toast";
import { formatDiscountDisplay } from "@/lib/promotion-status";

type Scope = "ALL_PRODUCTS" | "PRODUCTS" | "CATEGORIES" | "COLLECTIONS" | "SHIPPING";
type Kind = "PERCENTAGE" | "FIXED_AMOUNT";

export interface PromotionData {
  id?: string;
  name: string;
  type: "CODE" | "AUTO";
  code: string;
  scope: Scope;
  discountKind: Kind;
  discountValue: string;
  minOrderAmount: string;
  maxUses: string;
  maxUsesPerUser: string;
  firstOrderOnly: boolean;
  startsAt: string;
  endsAt: string;
  productIds: string[];
  categoryIds: string[];
  collectionIds: string[];
}

const DEFAULT_DATA: PromotionData = {
  name: "",
  type: "CODE",
  code: "",
  scope: "ALL_PRODUCTS",
  discountKind: "PERCENTAGE",
  discountValue: "",
  minOrderAmount: "",
  maxUses: "",
  maxUsesPerUser: "",
  firstOrderOnly: false,
  startsAt: new Date().toISOString().slice(0, 16),
  endsAt: "",
  productIds: [],
  categoryIds: [],
  collectionIds: [],
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
  scope: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><line x1="12" y1="3" x2="12" y2="7" /><line x1="12" y1="17" x2="12" y2="21" /><line x1="3" y1="12" x2="7" y2="12" /><line x1="17" y1="12" x2="21" y2="12" />
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

/* ── Scope picker (grille 5 cartes) ─────────────────── */
function ScopePicker({ value, onChange }: { value: Scope; onChange: (v: Scope) => void }) {
  const options: { value: Scope; title: string; desc: string; emoji: string }[] = [
    { value: "ALL_PRODUCTS", title: "Tous les produits", desc: "Applique à tout le catalogue", emoji: "🛍️" },
    { value: "PRODUCTS",     title: "Produits ciblés",   desc: "Uniquement les produits choisis", emoji: "📦" },
    { value: "CATEGORIES",   title: "Catégories",        desc: "Toute une famille de produits",   emoji: "🗂️" },
    { value: "COLLECTIONS",  title: "Collections",       desc: "Une ou plusieurs collections",    emoji: "✨" },
    { value: "SHIPPING",     title: "Livraison",         desc: "Réduit les frais de port",        emoji: "🚚" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-left p-3 rounded-xl border transition-all ${
            value === opt.value
              ? "border-text-primary bg-gradient-to-br from-slate-50 to-white shadow-sm ring-2 ring-text-primary/10"
              : "border-border bg-bg-primary hover:border-border-dark hover:bg-bg-secondary/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg leading-none">{opt.emoji}</span>
            <span className="text-[13px] font-body font-semibold text-text-primary">{opt.title}</span>
          </div>
          <p className="text-[11px] text-text-muted font-body leading-snug">{opt.desc}</p>
        </button>
      ))}
    </div>
  );
}

/* ── Picker multi-items (recherche + checkbox list) ─────────────── */
interface PickableItem { id: string; name: string; secondary?: string | null }
function MultiItemPicker({ items, selected, onChange, emptyLabel }: {
  items: PickableItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return items;
    return items.filter((it) =>
      norm(it.name).includes(q) || (it.secondary ? norm(it.secondary).includes(q) : false)
    );
  }, [items, query]);

  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-text-muted font-body border border-dashed border-border rounded-xl">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher…"
        className={inputClass}
      />
      <div className="flex items-center justify-between text-[11px] font-body text-text-muted px-1">
        <span>{selected.length} sélectionné{selected.length > 1 ? "s" : ""} sur {items.length}</span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-text-primary hover:underline"
          >
            Tout désélectionner
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto border border-border rounded-xl divide-y divide-border-light">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-text-muted font-body">Aucun résultat.</div>
        ) : (
          filtered.map((it) => {
            const checked = selected.includes(it.id);
            return (
              <label
                key={it.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                  checked ? "bg-emerald-50/60" : "hover:bg-bg-secondary/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(it.id)}
                  className="w-4 h-4 rounded border-border accent-text-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-body text-text-primary truncate">{it.name}</div>
                  {it.secondary && (
                    <div className="text-[11px] text-text-muted font-mono truncate">{it.secondary}</div>
                  )}
                </div>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ── Preview ───────────────────────────────────────────── */
function PromotionPreview({ data, targetsCount }: { data: PromotionData; targetsCount: number | null }) {
  const value = parseFloat(data.discountValue) || 0;
  const display = useMemo(
    () => formatDiscountDisplay(data.discountKind, value),
    [data.discountKind, value],
  );

  const scopeLabel = (() => {
    switch (data.scope) {
      case "ALL_PRODUCTS": return "Tous les produits";
      case "PRODUCTS":     return targetsCount != null ? `${targetsCount} produit${targetsCount > 1 ? "s" : ""} ciblé${targetsCount > 1 ? "s" : ""}` : "Produits ciblés";
      case "CATEGORIES":   return targetsCount != null ? `${targetsCount} catégorie${targetsCount > 1 ? "s" : ""}` : "Catégories";
      case "COLLECTIONS":  return targetsCount != null ? `${targetsCount} collection${targetsCount > 1 ? "s" : ""}` : "Collections";
      case "SHIPPING":     return "Frais de livraison";
    }
  })();

  const formatDate = (d: string) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  return (
    <aside className="lg:sticky lg:top-6 bg-bg-primary border border-border rounded-3xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-br from-text-primary to-text-secondary text-white flex items-center gap-2">
        <span className="relative inline-flex w-1.5 h-1.5">
          <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
          <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-[11px] font-body font-bold uppercase tracking-[0.18em]">Aperçu en direct</span>
      </div>

      <div className="relative mx-5 my-5 rounded-2xl overflow-hidden bg-gradient-to-br from-text-primary to-text-secondary text-white text-center px-5 py-6 shadow-lg">
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

        <div className="flex items-center justify-between py-1.5 border-b border-border-light">
          <span className="text-text-muted">Portée</span>
          <span className="font-medium text-text-primary text-right">{scopeLabel}</span>
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
          <span className="text-text-muted">Début</span>
          <span className="font-medium text-text-primary text-[11.5px]">{formatDate(data.startsAt)}</span>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-text-muted">Fin</span>
          <span className="font-medium text-text-primary text-[11.5px]">{data.endsAt ? formatDate(data.endsAt) : "Sans fin"}</span>
        </div>
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
  const [targets, setTargets] = useState<{
    products: { id: string; name: string; reference: string }[];
    categories: { id: string; name: string }[];
    collections: { id: string; name: string }[];
  } | null>(null);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    getPromotionTargets().then(setTargets).catch(() => setTargets({ products: [], categories: [], collections: [] }));
  }, []);

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

  const targetsCount = (() => {
    if (data.scope === "PRODUCTS")    return data.productIds.length;
    if (data.scope === "CATEGORIES")  return data.categoryIds.length;
    if (data.scope === "COLLECTIONS") return data.collectionIds.length;
    return null;
  })();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const input = {
      name: data.name,
      type: data.type,
      code: data.type === "CODE" ? data.code : undefined,
      scope: data.scope,
      discountKind: data.discountKind,
      discountValue: parseFloat(data.discountValue) || 0,
      minOrderAmount: data.minOrderAmount ? parseFloat(data.minOrderAmount) : undefined,
      maxUses: data.maxUses ? parseInt(data.maxUses) : undefined,
      maxUsesPerUser: data.maxUsesPerUser ? parseInt(data.maxUsesPerUser) : undefined,
      firstOrderOnly: data.firstOrderOnly,
      startsAt: data.startsAt,
      endsAt: data.endsAt || undefined,
      productIds:   data.scope === "PRODUCTS"    ? data.productIds    : [],
      categoryIds:  data.scope === "CATEGORIES"  ? data.categoryIds   : [],
      collectionIds: data.scope === "COLLECTIONS" ? data.collectionIds : [],
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

  const productItems: PickableItem[] = (targets?.products ?? []).map((p) => ({
    id: p.id, name: p.name, secondary: p.reference,
  }));
  const categoryItems: PickableItem[] = (targets?.categories ?? []).map((c) => ({
    id: c.id, name: c.name,
  }));
  const collectionItems: PickableItem[] = (targets?.collections ?? []).map((c) => ({
    id: c.id, name: c.name,
  }));

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
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

        {/* Section 2 : Portée */}
        <FormSection
          icon={Icons.scope}
          title="À quoi s'applique la promotion ?"
          description="Vous ne pouvez avoir qu'une seule promo automatique « tous produits » ou « livraison » à la fois."
        >
          <ScopePicker value={data.scope} onChange={(v) => update("scope", v)} />

          {data.scope === "PRODUCTS" && (
            <Field label="Produits ciblés">
              <MultiItemPicker
                items={productItems}
                selected={data.productIds}
                onChange={(ids) => update("productIds", ids)}
                emptyLabel="Aucun produit en ligne pour le moment."
              />
            </Field>
          )}
          {data.scope === "CATEGORIES" && (
            <Field label="Catégories ciblées">
              <MultiItemPicker
                items={categoryItems}
                selected={data.categoryIds}
                onChange={(ids) => update("categoryIds", ids)}
                emptyLabel="Aucune catégorie créée."
              />
            </Field>
          )}
          {data.scope === "COLLECTIONS" && (
            <Field label="Collections ciblées">
              <MultiItemPicker
                items={collectionItems}
                selected={data.collectionIds}
                onChange={(ids) => update("collectionIds", ids)}
                emptyLabel="Aucune collection créée."
              />
            </Field>
          )}
          {data.scope === "SHIPPING" && (
            <div className="text-[12px] text-text-muted font-body px-1">
              💡 Astuce : pour offrir totalement la livraison, choisissez « Pourcentage » et mettez 100 %.
            </div>
          )}
        </FormSection>

        {/* Section 3 : Remise */}
        <FormSection
          icon={Icons.percent}
          title="Remise"
          description="Ce que le client économise sur sa commande."
        >
          <Field label="Type de remise">
            <Segmented<Kind>
              value={data.discountKind}
              onChange={(v) => update("discountKind", v)}
              options={[
                { value: "PERCENTAGE",   label: "Pourcentage %" },
                { value: "FIXED_AMOUNT", label: "Montant fixe €" },
              ]}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        {/* Section 4 : Restrictions */}
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
          </div>
        </FormSection>

        {/* Section 5 : Dates */}
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

      <div className="hidden xl:block">
        <PromotionPreview data={data} targetsCount={targetsCount} />
      </div>
    </form>
  );
}
