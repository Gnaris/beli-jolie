"use client";

/**
 * Menu « Actions » (bouton ⋮) de la colonne Action sur /admin/clients.
 * Même pattern que le dropdown « Actions » de /admin/produits : bouton
 * trois-points → menu en portail positionné sous le bouton.
 *
 * Items groupés par thème :
 *   Fiche      : Voir / Panier / Commandes / Produits vus
 *   Actions    : Remise / Note / Créer une commande (bientôt)
 *   Contacter  : WhatsApp / Mail
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SendMailModal from "./SendMailModal";
import DeleteUserConfirmModal from "./DeleteUserConfirmModal";
import {
  normalizePhoneDigits,
  toWhatsAppNumber,
  isLikelyFrenchLandline,
} from "./PhoneContactIcons";
import { buildWhatsAppUrl } from "@/lib/whatsapp-message";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { UserStatus } from "@prisma/client";

interface Props {
  userId: string;
  userLabel: string;
  userEmail: string;
  phone: string | null;
  isPending: boolean;
  userStatus: UserStatus;
  acceptsNewsletter: boolean;
  hasWhatsapp: boolean | null;
}

export default function UserRowActionsMenu({
  userId,
  userLabel,
  userEmail,
  phone,
  isPending,
  userStatus,
  acceptsNewsletter,
  hasWhatsapp,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [, startDeactivate] = useTransition();

  async function askAndDeactivate() {
    setOpen(false);
    const ok = await confirm({
      type: "warning",
      title: "Désactiver ce client ?",
      message:
        "Son compte reste utilisable (connexion, navigation) mais il ne verra plus les tarifs ni les boutons d'achat tant que vous ne l'aurez pas réactivé. Un email de désactivation lui sera envoyé.",
      confirmLabel: "Désactiver",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    startDeactivate(async () => {
      const result = await updateUserStatus(userId, "DEACTIVATED");
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Client désactivé");
      router.refresh();
    });
  }

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 460;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    setPos({
      top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 6,
      left: rect.right - 260,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const rawPhone = (phone ?? "").trim();
  const hasPhone = rawPhone.length > 0 && normalizePhoneDigits(rawPhone).length >= 6;
  const waNumber = hasPhone ? toWhatsAppNumber(rawPhone) : null;
  const landline = hasPhone && isLikelyFrenchLandline(rawPhone);
  const waConfirmedYes = hasWhatsapp === true;
  const waConfirmedNo = hasWhatsapp === false;
  const canSendWhatsapp = waConfirmedYes && !!waNumber;

  const waDisabledReason = !hasPhone
    ? "Numéro de téléphone non renseigné"
    : waConfirmedNo
      ? "Numéro vérifié : ce client n'est pas sur WhatsApp"
      : !canSendWhatsapp && landline
        ? "Ligne fixe — WhatsApp indisponible"
        : !canSendWhatsapp
          ? "WhatsApp pas encore vérifié — cliquez sur l'icône verte dans la colonne Tél."
          : null;

  const canSendMail = acceptsNewsletter;
  const mailDisabledReason = canSendMail
    ? null
    : "Ce client n'a pas accepté les emails marketing (RGPD)";

  function openWhatsApp() {
    if (!waNumber) return;
    window.open(buildWhatsAppUrl(waNumber, ""), "_blank", "noopener,noreferrer");
  }

  const itemClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-text-primary hover:bg-bg-tertiary transition-colors no-underline border-none bg-transparent cursor-pointer text-left";
  const itemDisabledClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-text-muted opacity-50 cursor-not-allowed border-none bg-transparent text-left";
  const itemDangerClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-red-600 hover:bg-red-50 transition-colors border-none bg-transparent cursor-pointer text-left";
  const itemWarningClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-amber-700 hover:bg-amber-50 transition-colors border-none bg-transparent cursor-pointer text-left";
  const iconWrap =
    "w-[22px] h-[22px] inline-flex items-center justify-center rounded-md bg-bg-tertiary text-text-secondary shrink-0";
  const iconWrapDanger =
    "w-[22px] h-[22px] inline-flex items-center justify-center rounded-md bg-red-50 text-red-600 shrink-0";
  const iconWrapWarning =
    "w-[22px] h-[22px] inline-flex items-center justify-center rounded-md bg-amber-50 text-amber-700 shrink-0";
  const groupLabel =
    "block text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted px-2.5 pt-2 pb-1";
  const sepCls = "h-px bg-border my-1 mx-1.5";

  const closeOnly = () => setOpen(false);

  return (
    <>
      <div ref={anchorRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Actions du client"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Actions"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
            open
              ? "bg-bg-tertiary border border-border text-text-primary"
              : "bg-transparent border border-transparent text-text-muted hover:bg-bg-tertiary hover:border-border hover:text-text-primary"
          }`}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="19" cy="12" r="1.75" />
          </svg>
        </button>

        {open && createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="bg-bg-primary border border-border rounded-xl shadow-[var(--shadow-pop)] py-1.5 px-1.5 animate-fadeIn flex flex-col gap-px"
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 260 }}
          >
            {/* ─── Fiche ─── */}
            <span className={groupLabel}>Fiche</span>
            <Link href={`/admin/clients/${userId}`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconEye /></span>
              {isPending ? "Examiner la demande" : "Voir la fiche"}
            </Link>
            <Link href={`/admin/clients/${userId}?tab=cart`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconCart /></span>
              Voir le panier
            </Link>
            <Link href={`/admin/clients/${userId}?tab=orders`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconBox /></span>
              Voir les commandes
            </Link>
            <Link href={`/admin/clients/${userId}?tab=productViews`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconEyeHistory /></span>
              Produits vus par le client
            </Link>

            <div className={sepCls} />

            {/* ─── Actions ─── */}
            <span className={groupLabel}>Actions</span>
            <Link href={`/admin/clients/${userId}#remise`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconPercent /></span>
              Mettre une remise
            </Link>
            <Link href={`/admin/clients/${userId}?tab=note`} className={itemClass} onClick={closeOnly} role="menuitem">
              <span className={iconWrap}><IconPencil /></span>
              Mettre une note
            </Link>
            <Link
              href={`/admin/clients/${userId}/nouvelle-commande`}
              className={itemClass}
              onClick={closeOnly}
              role="menuitem"
            >
              <span className={iconWrap}><IconPlus /></span>
              Créer une commande
            </Link>

            <div className={sepCls} />

            {/* ─── Contacter ─── */}
            <span className={groupLabel}>Contacter</span>
            {canSendWhatsapp ? (
              <button
                type="button"
                onClick={() => { setOpen(false); openWhatsApp(); }}
                className={itemClass}
                role="menuitem"
              >
                <span className={iconWrap}><IconWhatsapp /></span>
                Envoyer un WhatsApp
              </button>
            ) : (
              <span
                className={itemDisabledClass}
                title={waDisabledReason ?? "WhatsApp indisponible"}
                role="menuitem"
                aria-disabled="true"
              >
                <span className={iconWrap}><IconWhatsapp /></span>
                Envoyer un WhatsApp
              </span>
            )}
            {canSendMail ? (
              <button
                type="button"
                onClick={() => { setOpen(false); setMailOpen(true); }}
                className={itemClass}
                role="menuitem"
              >
                <span className={iconWrap}><IconMail /></span>
                Envoyer un mail
              </button>
            ) : (
              <span
                className={itemDisabledClass}
                title={mailDisabledReason ?? "Mail indisponible"}
                role="menuitem"
                aria-disabled="true"
              >
                <span className={iconWrap}><IconMail /></span>
                Envoyer un mail
              </span>
            )}

            {userStatus === "APPROVED" && (
              <>
                <div className={sepCls} />
                <span className={groupLabel}>État du compte</span>
                <button
                  type="button"
                  onClick={askAndDeactivate}
                  className={itemWarningClass}
                  role="menuitem"
                >
                  <span className={iconWrapWarning}><IconBan /></span>
                  Désactiver le client
                </button>
              </>
            )}

            <div className={sepCls} />

            {/* ─── Zone de danger ─── */}
            <span className={groupLabel}>Zone de danger</span>
            <button
              type="button"
              onClick={() => { setOpen(false); setDeleteOpen(true); }}
              className={itemDangerClass}
              role="menuitem"
            >
              <span className={iconWrapDanger}><IconTrash /></span>
              Supprimer définitivement
            </button>
          </div>,
          document.body
        )}
      </div>

      {mailOpen && (
        <SendMailModal
          userId={userId}
          userLabel={userLabel}
          userEmail={userEmail}
          onClose={() => setMailOpen(false)}
        />
      )}

      {deleteOpen && (
        <DeleteUserConfirmModal
          userId={userId}
          userName={userLabel}
          onClose={() => setDeleteOpen(false)}
          onSuccess={() => {
            // On est déjà sur /admin/clients — un refresh suffit, pas de redirect
            // (contrairement à DeleteUserButton depuis la fiche client).
            setDeleteOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Icônes SVG inline ──────────────────────────────────────────────────────

function IconEye() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function IconEyeHistory() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

function IconPercent() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconWhatsapp() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function IconBan() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="5.636" y1="5.636" x2="18.364" y2="18.364" />
    </svg>
  );
}
