"use client";

/**
 * Modale de liaison BJ ↔ Ankorstore (version back-office reverse-engineered).
 *
 * Ancienne version : chargeait tout le catalogue Ankor via un stream SSE +
 * modale de mapping couleur. Nouvelle version : plus simple, elle interroge
 * Ankor par référence produit et propose les candidats détectés — l'admin
 * clique sur "Lier".
 */

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  searchAnkorstoreBoCandidatesForBjProduct,
  linkBjProductToAnkorstoreBo,
  type AnkorstoreBoLinkCandidate,
} from "@/app/actions/admin/ankorstore-bo";

interface Props {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
  /** Compat legacy — ignoré. Cette modale sert uniquement Ankorstore. */
  marketplace?: string;
}

export default function LinkAnkorstoreProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<AnkorstoreBoLinkCandidate[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await searchAnkorstoreBoCandidatesForBjProduct(productId);
      if (cancelled) return;
      if (r.success) {
        setCandidates(r.candidates);
        setErrorMsg(null);
      } else {
        setCandidates([]);
        setErrorMsg(r.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function handleLink(candidate: AnkorstoreBoLinkCandidate) {
    setLinkingId(candidate.ankorProductId);
    try {
      const r = await linkBjProductToAnkorstoreBo(productId, candidate.ankorProductId);
      if (r.success) {
        toast.success(
          "Produit lié",
          `Ankorstore #${candidate.ankorProductId} lié — ${r.linkedVariants ?? 0} variante(s) associée(s).`
        );
        onClose();
      } else {
        toast.error("Liaison échouée", r.error ?? "Erreur inconnue");
      }
    } finally {
      setLinkingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[min(720px,95vw)] overflow-hidden rounded-2xl bg-bg-primary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-text-muted">
              Ankorstore — Liaison
            </p>
            <h2 className="mt-1 font-heading text-lg font-bold text-text-primary">
              Lier « {productName} » ({reference})
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Ankorstore a été interrogé avec la référence <strong>{reference}</strong>. Sélectionne
              le produit correspondant s'il existe déjà chez Ankor.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted hover:bg-bg-secondary"
            aria-label="Fermer"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto p-5" style={{ maxHeight: "calc(85vh - 5rem)" }}>
          {loading && (
            <div className="flex items-center gap-3 rounded-xl bg-bg-secondary p-4 text-sm text-text-secondary">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={2}>
                <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
              </svg>
              Interrogation d'Ankorstore…
            </div>
          )}

          {!loading && errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <strong>Erreur :</strong> {errorMsg}
            </div>
          )}

          {!loading && !errorMsg && candidates.length === 0 && (
            <div className="rounded-xl border border-border bg-bg-secondary p-6 text-center">
              <p className="mb-2 font-medium text-text-primary">
                Aucun produit trouvé chez Ankorstore avec la référence « {reference} ».
              </p>
              <p className="text-sm text-text-secondary">
                Si tu penses qu'il existe déjà, vérifie que la référence produit est bien saisie et
                que les SKU des variantes commencent par cette référence côté Ankor.
              </p>
              <p className="mt-4 text-xs text-text-muted">
                Si le produit n'existe pas chez Ankor, ferme cette fenêtre et clique sur « Publier
                sur Ankorstore ».
              </p>
            </div>
          )}

          {!loading && candidates.length > 0 && (
            <ul className="space-y-3">
              {candidates.map((c) => (
                <li
                  key={c.ankorProductId}
                  className="flex items-start justify-between gap-4 rounded-xl border border-border bg-bg-primary p-4 hover:border-sky-300"
                >
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          c.confidence === "high"
                            ? "bg-emerald-100 text-emerald-800"
                            : c.confidence === "medium"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {c.confidence === "high"
                          ? "Correspondance forte"
                          : c.confidence === "medium"
                            ? "Correspondance partielle"
                            : "Correspondance faible"}
                      </span>
                      <span className="text-xs text-text-muted">
                        #{c.ankorProductId} · {c.matchedVariantCount} variante(s) reconnues
                      </span>
                    </div>
                    <p className="font-medium text-text-primary">{c.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.variants.map((v) => (
                        <span
                          key={v.id}
                          className="rounded-md bg-bg-secondary px-2 py-0.5 text-[11px] font-mono text-text-secondary"
                        >
                          {v.sku}
                          {v.colorValue ? ` · ${v.colorValue}` : ""}
                        </span>
                      ))}
                    </div>
                    <a
                      href={`https://fr.ankorstore.com${c.link}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-sky-700 underline hover:text-sky-900"
                    >
                      Voir la fiche Ankor →
                    </a>
                  </div>
                  <button
                    onClick={() => handleLink(c)}
                    disabled={linkingId !== null}
                    className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium ${
                      linkingId === c.ankorProductId
                        ? "bg-sky-100 text-sky-700"
                        : "bg-bg-dark text-text-inverse hover:bg-slate-800 disabled:opacity-50"
                    }`}
                  >
                    {linkingId === c.ankorProductId ? "Liaison…" : "Lier"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
