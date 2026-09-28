"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import { sendWhatsAppTemplate } from "@/app/actions/admin/whatsapp-send";
import { buildWhatsAppUrl } from "@/lib/whatsapp-message";
import type { WhatsAppTemplateDTO } from "@/app/actions/admin/whatsapp-templates";

/**
 * Bouton WhatsApp cliquable pour un client. Au clic sur l'icône verte,
 * un mini-menu s'ouvre : « Ouvrir sans message » + liste des modèles
 * disponibles + lien vers la page de gestion des modèles.
 *
 * Le body est rendu côté serveur (variables client/boutique/admin résolues
 * en un aller-retour) et l'ouverture WhatsApp se fait avec window.open pour
 * rester valide HTML dans un <Link> parent (carte mobile).
 */

export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

export function toWhatsAppNumber(raw: string): string | null {
  const cleaned = normalizePhoneDigits(raw);
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith("0") && cleaned.length === 10) return `33${cleaned.slice(1)}`;
  return cleaned;
}

export function isLikelyFrenchLandline(raw: string): boolean {
  const cleaned = normalizePhoneDigits(raw);
  if (cleaned.length === 10 && /^0[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("+33") && /^\+33[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("0033") && /^0033[123459]/.test(cleaned)) return true;
  if (cleaned.startsWith("33") && cleaned.length === 11 && /^33[123459]/.test(cleaned)) return true;
  return false;
}

interface Props {
  phone: string | null | undefined;
  /** Client destinataire. null si contact hors compte (AdminClientCard sans userId). */
  userId?: string | null;
  /** Modèles disponibles, chargés une fois par la page parente. */
  templates?: WhatsAppTemplateDTO[];
}

export default function PhoneContactIcons({ phone, userId = null, templates = [] }: Props) {
  const raw = (phone ?? "").trim();
  const hasPhone = raw.length > 0 && normalizePhoneDigits(raw).length >= 6;
  const waNumber = hasPhone ? toWhatsAppNumber(raw) : null;
  const isLandline = hasPhone && isLikelyFrenchLandline(raw);
  const waAvailable = hasPhone && !isLandline && waNumber !== null;

  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Positionne le menu (fixed) sous le trigger. Recalculé à l'ouverture + au
  // resize/scroll pour rester collé si la page bouge.
  useEffect(() => {
    if (!menuOpen) return;
    function updatePos() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [menuOpen]);

  // Ferme au clic hors du menu et du trigger + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen]);

  function openWhatsAppNow(renderedBody: string) {
    if (!waNumber) return;
    window.open(
      buildWhatsAppUrl(waNumber, renderedBody),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function handleSelectTemplate(templateId: string | null) {
    setMenuOpen(false);
    startTransition(async () => {
      const res = await sendWhatsAppTemplate({ templateId, userId, phone: raw });
      if (res.success) {
        openWhatsAppNow(res.renderedBody);
      } else {
        // Fallback : ouvre WhatsApp vide plutôt que de rien faire
        openWhatsAppNow("");
      }
    });
  }

  const baseClass =
    "inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors shrink-0";

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center gap-1.5 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      {waAvailable ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setMenuOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setMenuOpen((v) => !v);
            }
          }}
          title={`Ouvrir WhatsApp pour ${raw}`}
          className={`${baseClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer ${pending ? "opacity-60" : ""}`}
          aria-label="Ouvrir WhatsApp"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <WhatsAppIcon />
        </span>
      ) : (
        <span
          className={`${baseClass} border-border bg-bg-secondary text-text-muted/40 cursor-not-allowed`}
          title={
            !hasPhone
              ? "Numéro non renseigné"
              : isLandline
              ? "Ligne fixe — WhatsApp peu probable"
              : "WhatsApp indisponible"
          }
          aria-label="WhatsApp indisponible"
        >
          <WhatsAppIcon />
        </span>
      )}

      {mounted && menuOpen && waAvailable && menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 10500 }}
          className="w-72 rounded-xl border border-border bg-bg-primary shadow-xl overflow-hidden"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleSelectTemplate(null)}
            className="w-full text-left px-3 py-2.5 text-[13px] font-body text-text-primary hover:bg-bg-secondary transition-colors flex items-center gap-2"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-secondary text-text-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span className="flex-1">Ouvrir sans message</span>
          </button>

          {templates.length > 0 && (
            <>
              <div className="border-t border-border" />
              <div className="max-h-64 overflow-y-auto">
                <p className="px-3 pt-2 pb-1 text-[10px] font-body font-bold uppercase tracking-[0.14em] text-text-muted">
                  Mes modèles
                </p>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelectTemplate(t.id)}
                    className="w-full text-left px-3 py-2 text-[13px] font-body text-text-primary hover:bg-bg-secondary transition-colors flex items-start gap-2"
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
                      <WhatsAppIcon size={11} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{t.title}</span>
                      <span className="block text-[11px] text-text-muted truncate">
                        {t.body.replace(/\s+/g, " ").slice(0, 60)}
                        {t.body.length > 60 ? "…" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="border-t border-border" />
          <a
            href="/admin/marketing/whatsapp"
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            className="block px-3 py-2 text-[12px] font-body font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
          >
            {templates.length === 0 ? "+ Créer un modèle" : "Gérer mes modèles →"}
          </a>
        </div>,
        document.body,
      )}
    </span>
  );
}

function WhatsAppIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}
