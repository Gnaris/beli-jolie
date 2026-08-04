"use client";

/**
 * Menu déroulant "…" affiché dans la colonne Action de /admin/utilisateurs.
 *
 * Contenu :
 *   - "Voir la fiche" → lien vers /admin/utilisateurs/[id]
 *   - "Relancer par mail" → ouvre une modale qui :
 *       1. Interroge le serveur pour savoir quel scénario est applicable
 *          (panier abandonné ou client inactif) et si le rate-limit passe.
 *       2. Affiche un résumé compréhensible ("Ce client a un panier de 3
 *          articles depuis 2j → relance panier envoyée à foo@bar.com").
 *       3. Bouton "Confirmer" → envoie via sendManualRelance.
 *
 * Le rate-limit est appliqué côté serveur (24h par user). Le bouton reste
 * cliquable même après une relance récente : le serveur renvoie un message
 * clair "déjà relancé il y a X h" au lieu d'afficher un état pré-calculé
 * potentiellement obsolète.
 */

import Link from "next/link";
import { useRef, useState, useTransition, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  checkRelanceEligibility,
  sendManualRelance,
  sendManualRelancePreview,
  type RelanceEligibility,
  type RelanceKind,
} from "@/app/actions/admin/user-relance";

interface Props {
  userId: string;
  userLabel: string; // ex: "Marie Dupont" — affiché dans la modale
  userEmail: string;
  isPending: boolean; // true si status=PENDING (masque relance)
}

export default function UserRowActionsMenu({ userId, userLabel, userEmail, isPending }: Props) {
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Fermer le menu quand on clique hors du bouton ET hors du menu (portalisé).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideButton = buttonRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideButton && !insideMenu) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Fermer aussi au scroll (la position calculée devient obsolète).
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  function toggleMenu(e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setMenuPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      right: Math.max(4, window.innerWidth - rect.right),
    });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label="Actions"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
        </svg>
      </button>

      {mounted && open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed w-56 rounded-xl border border-border bg-bg-primary shadow-lg overflow-hidden z-[100]"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <Link
            href={`/admin/utilisateurs/${userId}`}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-text-primary hover:bg-bg-secondary"
            onClick={() => setOpen(false)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {isPending ? "Examiner la demande" : "Voir la fiche"}
          </Link>
          {!isPending && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setModalOpen(true);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-text-primary hover:bg-bg-secondary text-left border-t border-border"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              Relancer par mail
            </button>
          )}
        </div>,
        document.body,
      )}

      {modalOpen && (
        <RelanceMailModal
          userId={userId}
          userLabel={userLabel}
          userEmail={userEmail}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Modale de confirmation
// ─────────────────────────────────────────────────────────────

function RelanceMailModal({
  userId,
  userLabel,
  userEmail,
  onClose,
}: {
  userId: string;
  userLabel: string;
  userEmail: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<RelanceEligibility | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [previewEmail, setPreviewEmail] = useState("");
  const [selectedKind, setSelectedKind] = useState<RelanceKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await checkRelanceEligibility(userId);
      if (cancelled) return;
      if (!res.success) setCheckError(res.error);
      else {
        setEligibility(res.data);
        setPreviewEmail(res.data.adminEmail);
        // Pré-sélectionne le premier scénario envoyable (si dispo).
        const firstAvailable = res.data.options.find((o) => o.canSend);
        if (firstAvailable) setSelectedKind(firstAvailable.kind);
      }
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

  const selectedOption = selectedKind
    ? eligibility?.options.find((o) => o.kind === selectedKind) ?? null
    : null;

  function onConfirm() {
    if (!selectedKind) {
      toast.error("Choix manquant", "Sélectionnez un type de mail avant d'envoyer.");
      return;
    }
    startTransition(async () => {
      const res = await sendManualRelance(userId, selectedKind);
      if (!res.success) {
        toast.error("Envoi refusé", res.error);
      } else {
        toast.success("Email envoyé", res.message);
        router.refresh();
      }
      onClose();
    });
  }

  function onPreview() {
    if (!selectedKind) {
      toast.error("Choix manquant", "Sélectionnez un type de mail avant l'aperçu.");
      return;
    }
    if (!previewEmail.trim()) {
      toast.error("Adresse manquante", "Renseignez une adresse email pour l'aperçu.");
      return;
    }
    startPreviewTransition(async () => {
      const res = await sendManualRelancePreview(userId, selectedKind, previewEmail.trim());
      if (!res.success) {
        toast.error("Aperçu échoué", res.error);
      } else {
        toast.success("Aperçu envoyé", `Rendu réel envoyé à ${previewEmail} (préfixe [APERÇU]).`);
      }
    });
  }

  const canConfirm =
    !loading && !checkError && !!selectedOption && selectedOption.canSend;

  // Ferme uniquement si le clic COMMENCE ET SE TERMINE sur le backdrop.
  // Empêche la fermeture accidentelle quand on relâche un drag de sélection
  // de texte hors du modal.
  const mouseDownOnBackdrop = useRef(false);
  const onBackdropMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  };
  const onBackdropMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (mouseDownOnBackdrop.current && e.target === e.currentTarget) {
      onClose();
    }
    mouseDownOnBackdrop.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
      onMouseDown={onBackdropMouseDown}
      onMouseUp={onBackdropMouseUp}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-bg-primary shadow-2xl border border-border overflow-hidden">
        <div className="p-6 border-b border-border">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-100 text-[11px] font-semibold uppercase tracking-wider text-rose-700">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6" />
            </svg>
            Choix du mail de relance
          </div>
          <h3 className="mt-3 font-heading font-bold text-lg text-text-primary">
            Envoyer un email de relance
          </h3>
          <p
            className="mt-1 text-sm text-text-secondary"
            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
          >
            Destinataire : <span className="font-medium text-text-primary">{userLabel}</span> ({userEmail})
          </p>
        </div>

        <div className="p-6">
          {loading && (
            <div className="text-center py-6">
              <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
              <p className="mt-3 text-sm text-text-muted">Analyse de l&apos;état du client…</p>
            </div>
          )}

          {!loading && checkError && (
            <div
              className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700"
              style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}
            >
              {checkError}
            </div>
          )}

          {!loading && !checkError && eligibility && (
            <>
              {eligibility.globalBlockReason && (
                <div
                  className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-800"
                  style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}
                >
                  {eligibility.globalBlockReason}
                </div>
              )}

              {eligibility.options.length === 0 ? (
                <div className="p-6 rounded-lg bg-bg-secondary border border-border text-center text-sm text-text-secondary">
                  Aucun scénario de relance n&apos;est applicable pour ce client.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-text-muted">
                    Choisissez le type de mail
                  </div>
                  {eligibility.options.map((opt) => {
                    const isSelected = selectedKind === opt.kind;
                    const disabled = !opt.canSend;
                    return (
                      <button
                        key={opt.kind}
                        type="button"
                        onClick={() => opt.canSend && setSelectedKind(opt.kind)}
                        disabled={disabled}
                        style={{ whiteSpace: "normal" }}
                        className={`block w-full text-left p-4 rounded-xl border transition-all ${
                          disabled
                            ? "border-border bg-bg-secondary opacity-60 cursor-not-allowed"
                            : isSelected
                              ? "border-slate-900 bg-slate-50 ring-2 ring-slate-900/10"
                              : "border-border bg-bg-primary hover:border-slate-400 hover:bg-bg-secondary"
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              isSelected
                                ? "border-slate-900 bg-slate-900"
                                : "border-border bg-bg-primary"
                            }`}
                          >
                            {isSelected && (
                              <div className="w-2 h-2 rounded-full bg-white" />
                            )}
                          </div>
                          <div
                            className="flex-1 min-w-0"
                            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                          >
                            <div
                              className="font-heading font-semibold text-sm text-text-primary"
                              style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                            >
                              {opt.title}
                            </div>
                            <p
                              className="mt-1 text-xs text-text-secondary"
                              style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                            >
                              {opt.description}
                            </p>
                            <div
                              className="mt-2 text-[11px] text-text-muted"
                              style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
                            >
                              <span className="font-semibold">Sujet :</span>{" "}
                              <span>{opt.emailSubject}</span>
                            </div>
                            {opt.blockReason && (
                              <div
                                className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1"
                                style={{ wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}
                              >
                                {opt.blockReason}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedOption?.canSend && (
                <div className="mt-4 rounded-lg border border-dashed border-border p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-text-muted">
                    Vérifier avant d&apos;envoyer
                  </div>
                  <p className="mt-1 text-xs text-text-secondary">
                    Recevez le mail exact (avec les vraies données du client) pour le
                    contrôler. N&apos;écrit rien en base et ne touche pas le client.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="email"
                      value={previewEmail}
                      onChange={(e) => setPreviewEmail(e.target.value)}
                      placeholder="votre.email@exemple.com"
                      className="flex-1 min-w-[180px] px-2.5 py-2 rounded-lg border border-border bg-bg-primary text-sm text-text-primary"
                    />
                    <button
                      type="button"
                      onClick={onPreview}
                      disabled={previewPending || pending}
                      className="whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold border border-border text-text-primary hover:bg-bg-secondary disabled:opacity-40"
                    >
                      {previewPending ? "Envoi…" : "M'envoyer un aperçu"}
                    </button>
                  </div>
                </div>
              )}

              {selectedOption?.canSend && (
                <p className="mt-3 text-xs text-text-muted">
                  Après l&apos;envoi réel au client, il ne pourra plus recevoir de nouvelle relance
                  manuelle pendant 24 h.
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 bg-bg-secondary border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-primary border border-border"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || pending}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-bg-dark text-text-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Envoi…" : "Confirmer l'envoi"}
          </button>
        </div>
      </div>
    </div>
  );
}
