"use client";

/**
 * Modale « Envoyer un mail » — affichée depuis la Vue Mails de /admin/utilisateurs.
 *
 * Layout :
 *  ┌─────────────────────────────────────────────────────┐
 *  │ HEADER — destinataire                               │
 *  ├─────────────────────────────────────────────────────┤
 *  │ [Dropdown type de mail]                             │
 *  ├──────────────────────┬──────────────────────────────┤
 *  │ INFOS CONTEXTUELLES  │ APERÇU DU MAIL              │
 *  │ • Description        │ (rendu HTML approximatif    │
 *  │ • État client        │  de ce que verra le client) │
 *  │ • Dernier envoi      │                              │
 *  │ • Avertissements     │                              │
 *  ├──────────────────────┴──────────────────────────────┤
 *  │ FOOTER — Annuler · Envoyer                          │
 *  └─────────────────────────────────────────────────────┘
 *
 * L'aperçu affiché à l'étape 2 est un rendu approximatif. Les templates HTML
 * définitifs et l'envoi réel viennent à l'étape 3.
 */

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useRouter } from "next/navigation";
import {
  getClientMailContext,
  sendManualMail,
  searchProductsForMail,
  type ClientMailContext,
  type MailScenario,
  type PreviewData,
  type RestockSearchResult,
} from "@/app/actions/admin/user-mails";
import type { MailCondition } from "@/lib/mail-gates";

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
  onClose: () => void;
}

interface ScenarioMeta {
  key: MailScenario;
  title: string;
  emoji: string;
  description: string;
}

const SCENARIOS: ScenarioMeta[] = [
  {
    key: "ABANDONED_CART",
    title: "Panier abandonné",
    emoji: "🛒",
    description: "Rappel doux avec la liste des articles laissés + bouton « Reprendre ma commande ».",
  },
  {
    key: "INACTIVE_CLIENT",
    title: "Inactivité",
    emoji: "😴",
    description: "Message doux « on ne vous a pas vu depuis X jours » + nouveautés du catalogue.",
  },
  {
    key: "NEWSLETTER",
    title: "Newsletter",
    emoji: "📢",
    description: "Envoi d'un modèle de newsletter enregistré (nouvelle collection, saison, événement…).",
  },
  {
    key: "RESTOCK",
    title: "Retour en stock",
    emoji: "🔔",
    description: "Liste des favoris du client qui sont revenus en stock + lien vers chaque produit.",
  },
];

const OPTIONS: SelectOption[] = SCENARIOS.map((s) => ({
  value: s.key,
  label: `${s.emoji}  ${s.title}`,
}));

// ───────────────────────────────────────────────────────
// Rendu d'aperçu du mail selon le type
// Utilise les VRAIES données du client (panier réel, favoris réels, dernière connexion)
// ───────────────────────────────────────────────────────
function formatEuros(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function imageUrl(path: string | null): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Chip visuel d'une condition d'envoi mail.
 *  - Passed → fond vert, flèche verte
 *  - Failed bloquant → fond rouge, croix rouge
 *  - Failed soft (warning) → fond amber, triangle amber
 */
function ConditionChip({ condition }: { condition: MailCondition }) {
  const { passed, isSoft, label } = condition;

  let bg = "bg-emerald-50 border-emerald-200 text-emerald-800";
  let icon = "✓";
  let iconColor = "text-emerald-600";

  if (!passed && isSoft) {
    bg = "bg-amber-50 border-amber-200 text-amber-800";
    icon = "⚠";
    iconColor = "text-amber-600";
  } else if (!passed && !isSoft) {
    bg = "bg-red-50 border-red-200 text-red-800";
    icon = "✕";
    iconColor = "text-red-600";
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-body font-medium leading-tight ${bg}`}
      style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
    >
      <span className={`font-bold ${iconColor} shrink-0`} aria-hidden>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Sélecteur de produits pour le mail RESTOCK.
 * - Search input (debounced côté parent)
 * - Liste de résultats cliquables
 * - Chips des produits déjà sélectionnés avec bouton ✕
 */
function RestockProductPicker({
  selected,
  query,
  onQueryChange,
  results,
  searching,
  onAdd,
  onRemove,
}: {
  selected: RestockSearchResult[];
  query: string;
  onQueryChange: (q: string) => void;
  results: RestockSearchResult[];
  searching: boolean;
  onAdd: (p: RestockSearchResult) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-primary p-4 space-y-3">
      {/* Chips des produits sélectionnés */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-[12px] font-body font-medium text-slate-800 max-w-full"
              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
              title={`${p.name} (stock : ${p.stock})`}
            >
              {p.imagePath && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(p.imagePath)} alt="" className="w-5 h-5 rounded object-cover shrink-0" />
              )}
              <span className="min-w-0 truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                aria-label={`Retirer ${p.name}`}
                className="shrink-0 text-slate-500 hover:text-red-600 transition-colors"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Rechercher un produit à annoncer (nom ou référence)…"
          className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-primary transition-colors"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
        )}
      </div>

      {/* Résultats */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-secondary max-h-60 overflow-y-auto divide-y divide-border">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onAdd(r)}
              disabled={r.stock <= 0}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {r.imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl(r.imagePath)} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded bg-bg-tertiary shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-body font-medium text-text-primary truncate">{r.name}</div>
                <div className="text-[11px] text-text-muted font-mono">{r.reference} · Stock : {r.stock}</div>
              </div>
              <span className="text-[12px] font-body font-semibold text-text-primary shrink-0 tabular-nums">
                {(r.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </span>
            </button>
          ))}
        </div>
      )}

      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-[12px] text-text-muted italic text-center py-2">
          Aucun produit ne correspond à « {query} ».
        </p>
      )}

      {selected.length === 0 && query.trim().length < 2 && (
        <p className="text-[11.5px] text-text-muted italic">
          Tapez au moins 2 caractères pour rechercher un produit.
        </p>
      )}
    </div>
  );
}

function MailPreview({
  scenario,
  preview,
  restockProducts,
}: {
  scenario: MailScenario | null;
  preview: PreviewData;
  /** Produits sélectionnés par l'admin pour le mail RESTOCK (remplace preview.favoritesInStock) */
  restockProducts?: RestockSearchResult[];
}) {
  if (!scenario) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border p-8 flex items-center justify-center text-center">
        <div>
          <svg className="mx-auto w-10 h-10 text-text-muted mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <p className="text-sm font-body text-text-muted">Choisis un type de mail pour voir l&apos;aperçu.</p>
        </div>
      </div>
    );
  }

  const name = preview.firstName;
  const cartItems = preview.cart.items;
  // Pour RESTOCK : on utilise la sélection admin (adaptée au format FavoritePreview).
  const favorites = scenario === "RESTOCK"
    ? (restockProducts ?? []).map((p) => ({
        productName: p.name,
        colorName: p.colorName,
        priceCents: p.priceCents,
        imagePath: p.imagePath,
      }))
    : preview.favoritesInStock;
  const daysInactive = preview.daysSinceLastActivity;

  return (
    <div
      className="mail-preview-root w-full max-w-full rounded-xl border border-border bg-slate-100 p-3"
      style={{ boxSizing: "border-box", overflow: "hidden" }}
    >
      <style>{`
        .mail-preview-root { min-width: 0; width: 100%; }
        .mail-preview-root p,
        .mail-preview-root div,
        .mail-preview-root h1,
        .mail-preview-root h2,
        .mail-preview-root h3,
        .mail-preview-root span,
        .mail-preview-root li,
        .mail-preview-root a {
          box-sizing: border-box !important;
          max-width: 100% !important;
          min-width: 0 !important;
          word-break: break-word !important;
          overflow-wrap: anywhere !important;
        }
        .mail-preview-root p, .mail-preview-root h1, .mail-preview-root h2, .mail-preview-root h3, .mail-preview-root li {
          white-space: normal !important;
        }
        .mail-preview-root img { max-width: 100% !important; height: auto !important; }
      `}</style>
      <div className="w-full max-w-full rounded-lg bg-white shadow-sm overflow-hidden" style={{ fontFamily: "Roboto, sans-serif", boxSizing: "border-box", textAlign: "center" }}>

        {/* ═══ PANIER ABANDONNÉ ═══ */}
        {scenario === "ABANDONED_CART" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#d4a574,#b8895d)", padding: "32px 24px", color: "white", textAlign: "center" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>Beli &amp; Jolie</div>
              <h1 style={{ fontFamily: "Poppins", fontSize: "22px", fontWeight: 700, margin: "8px 0 0" }}>
                Votre panier vous attend 🛒
              </h1>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <p style={{ fontSize: "14px", color: "#0f172a", marginBottom: "12px" }}>Bonjour {name},</p>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "10px" }}>
                Vous avez laissé <strong>{cartItems.length} article{cartItems.length > 1 ? "s" : ""}</strong>{" "}
                dans votre panier.
              </p>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "16px" }}>
                Ils vous attendent toujours !
              </p>
              <div style={{ background: "#f8fafc", borderRadius: "10px", padding: "12px", marginBottom: "16px" }}>
                {cartItems.map((it, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: i < cartItems.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                    {it.imagePath && (
                      <img src={imageUrl(it.imagePath)} alt="" style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", color: "#0f172a", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.productName}</div>
                      {it.colorName && (
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>{it.colorName} · x{it.quantity}</div>
                      )}
                    </div>
                    <div style={{ fontSize: "12px", color: "#0f172a", fontWeight: 700, whiteSpace: "nowrap" }}>{formatEuros(it.totalCents)}</div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #cbd5e1", paddingTop: "8px", marginTop: "8px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Total</span>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{formatEuros(preview.cart.totalCents)}</span>
                </div>
              </div>

              <div style={{ textAlign: "center" }}>
                <a href="#" style={{ display: "inline-block", background: "#0f172a", color: "white", padding: "12px 28px", borderRadius: "8px", fontFamily: "Poppins", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                  Reprendre ma commande →
                </a>
              </div>
            </div>
            <div style={{ background: "#0f172a", color: "white", padding: "16px", textAlign: "center", fontSize: "10px", opacity: 0.7 }}>
              Beli &amp; Jolie · Grossiste en bijoux
            </div>
          </>
        )}

        {/* ═══ INACTIVITÉ ═══ */}
        {scenario === "INACTIVE_CLIENT" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#7dd3fc,#38bdf8)", padding: "32px 24px", color: "white", textAlign: "center" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>Beli &amp; Jolie</div>
              <h1 style={{ fontFamily: "Poppins", fontSize: "22px", fontWeight: 700, margin: "8px 0 0" }}>On vous a pas vu depuis un moment 😴</h1>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <p style={{ fontSize: "14px", color: "#0f172a", marginBottom: "12px" }}>Bonjour {name},</p>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "10px" }}>
                Cela fait <strong>{daysInactive ?? 0} jour{(daysInactive ?? 0) > 1 ? "s" : ""}</strong>{" "}
                qu&apos;on ne vous a pas vu sur notre boutique.
              </p>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "16px" }}>
                Nous avons plein de nouveautés à vous montrer !
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
                <li style={{ padding: "6px 0", fontSize: "13px", color: "#334155", borderBottom: "1px solid #f1f5f9" }}>✨ Nouvelle collection automne</li>
                <li style={{ padding: "6px 0", fontSize: "13px", color: "#334155", borderBottom: "1px solid #f1f5f9" }}>💎 Nouveaux modèles en stock</li>
                <li style={{ padding: "6px 0", fontSize: "13px", color: "#334155" }}>🎁 Livraison offerte dès 200 € HT</li>
              </ul>
              <div style={{ textAlign: "center" }}>
                <a href="#" style={{ display: "inline-block", background: "#0f172a", color: "white", padding: "12px 28px", borderRadius: "8px", fontFamily: "Poppins", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                  Découvrir les nouveautés →
                </a>
              </div>
            </div>
            <div style={{ background: "#0f172a", color: "white", padding: "16px", textAlign: "center", fontSize: "10px", opacity: 0.7 }}>
              Beli &amp; Jolie · Grossiste en bijoux
            </div>
          </>
        )}

        {/* ═══ NEWSLETTER ═══ */}
        {scenario === "NEWSLETTER" && (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📢</div>
            <h3 style={{ fontFamily: "Poppins", fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>
              L&apos;aperçu dépend du modèle choisi
            </h3>
            <p style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
              La newsletter utilise un des modèles composés à l&apos;avance.<br />
              Le choix du modèle et son aperçu s&apos;afficheront à l&apos;étape suivante<br />
              (étape 4 — en cours de développement).
            </p>
          </div>
        )}

        {/* ═══ RETOUR EN STOCK ═══ */}
        {scenario === "RESTOCK" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#6ee7b7,#10b981)", padding: "32px 24px", color: "white", textAlign: "center" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>Beli &amp; Jolie</div>
              <h1 style={{ fontFamily: "Poppins", fontSize: "22px", fontWeight: 700, margin: "8px 0 0" }}>
                Vos favoris sont revenus 🔔
              </h1>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <p style={{ fontSize: "14px", color: "#0f172a", marginBottom: "12px" }}>Bonjour {name},</p>
              <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "16px" }}>
                Bonne nouvelle :{" "}
                <strong>{favorites.length} de vos favoris</strong>{" "}
                {favorites.length > 1 ? "sont de nouveau disponibles" : "est de nouveau disponible"}.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
                {favorites.slice(0, 6).map((f, i) => (
                  <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px" }}>
                    {f.imagePath ? (
                      <img src={imageUrl(f.imagePath)} alt="" style={{ width: "100%", height: "70px", objectFit: "cover", borderRadius: "6px", marginBottom: "6px", display: "block" }} />
                    ) : (
                      <div style={{ height: "70px", background: "#f1f5f9", borderRadius: "6px", marginBottom: "6px" }} />
                    )}
                    <div style={{ fontSize: "11px", fontFamily: "Poppins", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.productName}</div>
                    {f.colorName && <div style={{ fontSize: "10px", color: "#64748b" }}>{f.colorName}</div>}
                    <div style={{ fontSize: "11px", color: "#0f172a", fontWeight: 700, marginTop: "2px" }}>{formatEuros(f.priceCents)}</div>
                  </div>
                ))}
              </div>

              <div style={{ textAlign: "center" }}>
                <a href="#" style={{ display: "inline-block", background: "#0f172a", color: "white", padding: "12px 28px", borderRadius: "8px", fontFamily: "Poppins", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                  Voir tous mes favoris →
                </a>
              </div>
            </div>
            <div style={{ background: "#0f172a", color: "white", padding: "16px", textAlign: "center", fontSize: "10px", opacity: 0.7 }}>
              Beli &amp; Jolie · Grossiste en bijoux
            </div>
          </>
        )}
      </div>
      <p className="text-[10px] font-body text-text-muted text-center mt-2 italic">
        Aperçu du contenu réel qui sera envoyé — le rendu peut légèrement varier selon le client mail du destinataire.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────
// Modale principale
// ───────────────────────────────────────────────────────
export default function SendMailModal({ userId, userLabel, userEmail, onClose }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<ClientMailContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [sending, startSending] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getClientMailContext(userId);
      if (cancelled) return;
      if (!res.success) setError(res.error);
      else setCtx(res.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mouseDownOnBackdrop = useRef(false);
  const onBackdropDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
    mouseDownOnBackdrop.current = false;
  };

  const selectedMeta = selected ? SCENARIOS.find((s) => s.key === selected) : null;
  const selectedCtx = ctx && selected ? ctx.scenarios[selected as MailScenario] : null;

  // ─── Sélection de produits pour RESTOCK ───────────────────────
  const [restockProducts, setRestockProducts] = useState<RestockSearchResult[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RestockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Debounce la recherche produits
  useEffect(() => {
    if (selected !== "RESTOCK") { setSearchResults([]); return; }
    const q = productQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchProductsForMail(q);
      if (cancelled) return;
      setSearching(false);
      if (res.success) {
        // Filtre ceux déjà sélectionnés
        const selectedIds = new Set(restockProducts.map((p) => p.id));
        setSearchResults(res.results.filter((r) => !selectedIds.has(r.id)));
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [productQuery, selected, restockProducts]);

  // Reset sélection quand on change de scenario
  useEffect(() => {
    if (selected !== "RESTOCK") {
      setRestockProducts([]);
      setProductQuery("");
      setSearchResults([]);
    }
  }, [selected]);

  // Override des conditions RESTOCK côté client (les 2 gates liées à la sélection)
  const displayedConditions = useMemo<MailCondition[]>(() => {
    if (!selectedCtx) return [];
    if (selected !== "RESTOCK") return selectedCtx.conditions;
    const count = restockProducts.length;
    const allInStock = count === 0 || restockProducts.every((p) => p.stock > 0);
    return selectedCtx.conditions.map((c) => {
      if (c.code === "PRODUCTS_SELECTED") return { ...c, passed: count > 0 };
      if (c.code === "PRODUCTS_IN_STOCK") return { ...c, passed: count === 0 || allInStock };
      return c;
    });
  }, [selectedCtx, selected, restockProducts]);

  const displayedBlockers = useMemo(
    () => displayedConditions.filter((c) => !c.passed && !c.isSoft),
    [displayedConditions],
  );
  const blockersCount = displayedBlockers.length;
  const isBlocked = blockersCount > 0;
  const canConfirm = !!selected && !loading && !error && !isBlocked;

  function onSend() {
    if (!selected) return;

    // Newsletter : redirige vers la page de choix de modèle (étape 5)
    if (selected === "NEWSLETTER") {
      toast.info(
        "Newsletter",
        "L'envoi de newsletter passe par la sélection d'un modèle depuis la page dédiée.",
      );
      onClose();
      router.push("/admin/utilisateurs/newsletters");
      return;
    }

    startSending(async () => {
      const payload = selected === "RESTOCK"
        ? { productIds: restockProducts.map((p) => p.id) }
        : undefined;
      const res = await sendManualMail(userId, selected as MailScenario, payload);
      if (!res.success) {
        toast.error("Envoi refusé", res.error);
        return;
      }
      toast.success("Mail envoyé", res.message);
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onMouseDown={onBackdropDown}
      onMouseUp={onBackdropUp}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden max-h-[92vh] flex flex-col">

        {/* ═══ HEADER ═══ */}
        <div className="relative overflow-hidden shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950" />
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full blur-3xl bg-violet-500/20 pointer-events-none" />
          <div className="absolute -bottom-16 -left-8 w-64 h-64 rounded-full blur-3xl bg-sky-500/15 pointer-events-none" />
          <div className="relative p-6 text-white text-left">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur text-[10px] font-body font-bold uppercase tracking-[0.18em]">
              <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
              Envoyer un mail
            </div>
            <h2 className="mt-3 font-heading font-bold text-2xl text-left">Envoi manuel d&apos;un mail à un client</h2>
            <div className="mt-2 text-sm text-white/70 text-left" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
              <span className="block">
                Destinataire :{" "}
                <span className="font-semibold text-white">{userLabel}</span>
              </span>
              <span className="block text-white/60 text-xs mt-0.5">{userEmail}</span>
            </div>
          </div>
        </div>

        {/* ═══ CORPS ═══ */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {loading && (
            <div className="text-center py-20">
              <div className="inline-block w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
              <p className="mt-3 text-sm text-text-muted">Analyse du contexte client…</p>
            </div>
          )}

          {!loading && error && (
            <div className="p-6">
              <div className="p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
                {error}
              </div>
            </div>
          )}

          {!loading && !error && ctx && (
            <div className="p-6 space-y-5">

              {/* Dropdown du type — en tête, pleine largeur */}
              <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-5">
                <label className="block text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-3">
                  1. Quel type de mail souhaites-tu envoyer ?
                </label>
                <CustomSelect
                  value={selected}
                  onChange={setSelected}
                  options={OPTIONS}
                  placeholder="Choisir un type de mail…"
                  size="md"
                />
                {selectedMeta && (
                  <p className="text-[12.5px] font-body text-text-secondary mt-3 leading-relaxed" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                    {selectedMeta.description}
                  </p>
                )}
              </div>

              {/* Contenu vertical : contexte → dernier envoi → avertissements → aperçu */}
              {selected && selectedCtx && selectedMeta ? (
                <div className="space-y-5 min-w-0">

                  {/* Sélecteur produits — uniquement pour RESTOCK */}
                  {selected === "RESTOCK" && (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                        2. Produits à annoncer
                      </div>
                      <RestockProductPicker
                        selected={restockProducts}
                        query={productQuery}
                        onQueryChange={setProductQuery}
                        results={searchResults}
                        searching={searching}
                        onAdd={(p) => {
                          setRestockProducts((prev) => [...prev, p]);
                          setProductQuery("");
                          setSearchResults([]);
                        }}
                        onRemove={(id) => setRestockProducts((prev) => prev.filter((p) => p.id !== id))}
                      />
                    </div>
                  )}

                  {/* Conditions à réunir (grille) — numérotation dynamique */}
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                      {selected === "RESTOCK" ? "3." : "2."} Conditions à réunir
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {displayedConditions.map((c) => (
                        <ConditionChip key={c.code} condition={c} />
                      ))}
                    </div>
                  </div>

                  {/* Blocages (bloque l'envoi) — utilise displayedBlockers (recomputé côté client pour RESTOCK) */}
                  {isBlocked && (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-red-700 mb-2 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        Envoi bloqué — détail{blockersCount > 1 ? "s" : ""}
                      </div>
                      <div className="space-y-2">
                        {displayedBlockers.map((b) => (
                          <p
                            key={b.code}
                            className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[12.5px] font-body text-red-800 leading-relaxed text-center"
                            style={{
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              whiteSpace: "normal",
                              margin: 0,
                            }}
                          >
                            <span className="font-bold text-red-600 mr-1">✕</span>
                            {b.label}
                          </p>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] font-body text-red-700 italic leading-relaxed">
                        L&apos;envoi est refusé tant qu&apos;au moins une raison bloquante subsiste.
                      </p>
                    </div>
                  )}

                  {/* Aperçu du mail (masqué si envoi bloqué — inutile) */}
                  {!isBlocked && (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                        {selected === "RESTOCK" ? "4." : "3."} Aperçu du mail
                      </div>
                      <MailPreview
                        scenario={selected as MailScenario}
                        preview={ctx.preview}
                        restockProducts={selected === "RESTOCK" ? restockProducts : undefined}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center">
                  <svg className="mx-auto w-10 h-10 text-text-muted mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <p className="text-sm font-body text-text-muted">
                    Choisis un type de mail dans le menu ci-dessus.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══ FOOTER ═══ */}
        <div className="px-6 py-4 bg-bg-secondary border-t border-border flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-lg text-sm font-body font-medium text-text-secondary hover:bg-bg-primary border border-border transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canConfirm || sending}
            title={isBlocked ? "Envoi bloqué — corrigez les raisons ci-dessus." : undefined}
            className="px-5 py-2.5 rounded-lg text-sm font-body font-bold bg-gradient-to-br from-slate-800 to-slate-900 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity inline-flex items-center gap-2"
          >
            {sending ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Envoi…
              </>
            ) : isBlocked ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                Envoi bloqué
              </>
            ) : (
              <>
                Envoyer le mail
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
