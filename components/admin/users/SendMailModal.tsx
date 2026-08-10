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

import { useEffect, useRef, useState, useTransition, type MouseEvent as ReactMouseEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";
import { useRouter } from "next/navigation";
import {
  getClientMailContext,
  sendManualMail,
  type ClientMailContext,
  type MailScenario,
  type PreviewData,
} from "@/app/actions/admin/user-mails";

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

function EmptyStatePreview({ text }: { text: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "2px dashed #cbd5e1", borderRadius: "10px", padding: "16px 14px", textAlign: "center", margin: "12px 0" }}>
      <div style={{ fontSize: "22px", marginBottom: "4px" }}>⚠️</div>
      <p style={{ fontSize: "12px", color: "#64748b", margin: 0, lineHeight: 1.5, wordBreak: "break-word", overflowWrap: "anywhere" }}>{text}</p>
    </div>
  );
}

function MailPreview({
  scenario,
  preview,
}: {
  scenario: MailScenario | null;
  preview: PreviewData;
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
  const favorites = preview.favoritesInStock;
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
      <div className="w-full max-w-full rounded-lg bg-white shadow-sm overflow-hidden" style={{ fontFamily: "Roboto, sans-serif", boxSizing: "border-box" }}>

        {/* ═══ PANIER ABANDONNÉ ═══ */}
        {scenario === "ABANDONED_CART" && (
          <>
            <div style={{ background: "linear-gradient(135deg,#d4a574,#b8895d)", padding: "32px 24px", color: "white", textAlign: "center" }}>
              <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>Beli &amp; Jolie</div>
              <h1 style={{ fontFamily: "Poppins", fontSize: "22px", fontWeight: 700, margin: "8px 0 0" }}>
                {cartItems.length > 0 ? "Votre panier vous attend 🛒" : "On vous a pas vu depuis un moment 👋"}
              </h1>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <p style={{ fontSize: "14px", color: "#0f172a", marginBottom: "12px" }}>Bonjour {name},</p>

              {cartItems.length === 0 ? (
                <>
                  <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "12px" }}>
                    Vous n&apos;avez actuellement <strong>rien dans votre panier</strong>. Nos nouveautés
                    vous attendent — venez jeter un œil à notre catalogue !
                  </p>
                  <EmptyStatePreview text="Panier vide — le mail ne contient aucune liste d'articles, uniquement un message d'invitation générique." />
                </>
              ) : (
                <>
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
                </>
              )}

              <div style={{ textAlign: "center" }}>
                <a href="#" style={{ display: "inline-block", background: "#0f172a", color: "white", padding: "12px 28px", borderRadius: "8px", fontFamily: "Poppins", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                  {cartItems.length > 0 ? "Reprendre ma commande →" : "Découvrir nos nouveautés →"}
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
              {daysInactive === null ? (
                <>
                  <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "12px" }}>
                    Vous n&apos;avez encore jamais visité notre boutique en ligne.
                    Nos nouveautés vous attendent !
                  </p>
                  <EmptyStatePreview text="Ce client ne s'est jamais connecté — le mail dira simplement « nous vous attendons »." />
                </>
              ) : (
                <>
                  <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "10px" }}>
                    Cela fait <strong>{daysInactive} jour{daysInactive > 1 ? "s" : ""}</strong>{" "}
                    qu&apos;on ne vous a pas vu sur notre boutique.
                  </p>
                  <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "16px" }}>
                    Nous avons plein de nouveautés à vous montrer !
                  </p>
                </>
              )}
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
                {favorites.length > 0 ? "Vos favoris sont revenus 🔔" : "Vos favoris ne sont pas encore là"}
              </h1>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <p style={{ fontSize: "14px", color: "#0f172a", marginBottom: "12px" }}>Bonjour {name},</p>

              {favorites.length === 0 ? (
                <>
                  <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6, marginBottom: "12px" }}>
                    Aucun de vos favoris n&apos;est actuellement disponible en stock.
                    Nous vous préviendrons dès qu&apos;ils reviendront !
                  </p>
                  <EmptyStatePreview text="Ce client n'a aucun favori en stock — le mail n'a rien de concret à mettre en avant." />
                </>
              ) : (
                <>
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
                </>
              )}

              <div style={{ textAlign: "center" }}>
                <a href="#" style={{ display: "inline-block", background: "#0f172a", color: "white", padding: "12px 28px", borderRadius: "8px", fontFamily: "Poppins", fontWeight: 600, fontSize: "13px", textDecoration: "none" }}>
                  {favorites.length > 0 ? "Voir tous mes favoris →" : "Parcourir le catalogue →"}
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

  const canConfirm = !!selected && !loading && !error;
  const selectedMeta = selected ? SCENARIOS.find((s) => s.key === selected) : null;
  const selectedCtx = ctx && selected ? ctx.scenarios[selected as MailScenario] : null;

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
      const res = await sendManualMail(userId, selected as MailScenario);
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
          <div className="relative p-6 text-white">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur text-[10px] font-body font-bold uppercase tracking-[0.18em]">
              <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
              Envoyer un mail
            </div>
            <h2 className="mt-3 font-heading font-bold text-2xl">Envoi manuel d&apos;un mail à un client</h2>
            <div className="mt-2 text-sm text-white/70" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
              Destinataire :{" "}
              <span className="font-semibold text-white">{userLabel}</span>{" "}
              <span className="text-white/60">({userEmail})</span>
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

                  {/* 2. Contexte client */}
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                      2. Contexte du client
                    </div>
                    <div className="rounded-xl bg-bg-secondary border border-border p-4">
                      <p className="text-[13.5px] font-body text-text-primary leading-relaxed" style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}>
                        {selectedCtx.contextLine}
                      </p>
                      {selectedCtx.lastSentAt && (
                        <p className="text-[12px] font-body text-text-muted mt-2 pt-2 border-t border-border">
                          <span className="font-semibold">Dernier envoi :</span>{" "}
                          {selectedCtx.lastSentAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 3. Avertissements */}
                  {selectedCtx.warnings.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-amber-700 mb-2 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.516 11.591c.75 1.335-.213 2.98-1.742 2.98H3.483c-1.53 0-2.493-1.645-1.743-2.98L8.257 3.1z" />
                        </svg>
                        3. {selectedCtx.warnings.length} avertissement{selectedCtx.warnings.length > 1 ? "s" : ""}
                      </div>
                      <div className="space-y-2">
                        {selectedCtx.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-[12.5px] font-body text-amber-800 leading-relaxed"
                            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                          >
                            <svg className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.516 11.591c.75 1.335-.213 2.98-1.742 2.98H3.483c-1.53 0-2.493-1.645-1.743-2.98L8.257 3.1zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" />
                            </svg>
                            <span className="flex-1">{w}</span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] font-body text-text-muted italic leading-relaxed">
                        Aucun blocage — les avertissements sont juste pour t&apos;alerter.
                      </p>
                    </div>
                  )}

                  {selectedCtx.warnings.length === 0 && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5 text-[12.5px] font-body text-emerald-800 flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" fillRule="evenodd" />
                      </svg>
                      Aucun avertissement — tout va bien.
                    </div>
                  )}

                  {/* 4. Aperçu du mail */}
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
                      {selectedCtx.warnings.length > 0 ? "4." : "3."} Aperçu du mail
                    </div>
                    <MailPreview scenario={selected as MailScenario} preview={ctx.preview} />
                  </div>
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
