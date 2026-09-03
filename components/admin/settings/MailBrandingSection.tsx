"use client";

/**
 * Section « Habillage des mails » — Paramètres > Habillage des mails.
 *
 * Édite les deux configs JSON `mail_header_config` + `mail_footer_config`,
 * appliquées globalement aux 4 mails qui utilisent `wrapMail()` (newsletter,
 * restock, panier abandonné, client inactif).
 *
 * Le fond du header accepte couleur unie OU dégradé (via GradientBuilder).
 * Aperçu HTML rendu en direct dans un iframe.
 */

import { useEffect, useRef, useState } from "react";
import Image from "@/components/ui/SmartImage";
import { useToast } from "@/components/ui/Toast";
import { BackgroundInput, ColorInput } from "@/components/admin/shared/GradientBuilder";
import InsertVariableButton from "@/components/admin/shared/InsertVariableButton";
import {
  updateMailHeaderConfig,
  updateMailFooterConfig,
  resetMailBranding,
} from "@/app/actions/admin/mail-branding";
import {
  DEFAULT_MAIL_HEADER,
  DEFAULT_MAIL_FOOTER,
  type MailBranding,
  type MailHeaderConfig,
  type MailFooterConfig,
} from "@/lib/mail-branding-types";
import { isGradientString } from "@/lib/gradient-parser";

/** Un logo en attente : blob URL local (affiché) + File (à envoyer au save). */
interface PendingLogo {
  blobUrl: string;
  file: File;
}

interface Props {
  initial: MailBranding;
  shopName: string;
  legalLine: string;
  baseUrl: string;
}

export default function MailBrandingSection({ initial, shopName, legalLine, baseUrl }: Props) {
  const [header, setHeader] = useState<MailHeaderConfig>(initial.header);
  const [footer, setFooter] = useState<MailFooterConfig>(initial.footer);
  const [savingHeader, setSavingHeader] = useState(false);
  const [savingFooter, setSavingFooter] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Logo en attente : présent tant que l'admin n'a pas cliqué « Enregistrer ».
  // On stocke le File localement + on affiche via blob URL — l'upload serveur
  // n'a lieu qu'au save du header.
  const [pendingLogo, setPendingLogo] = useState<PendingLogo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const footerMessageRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  // Révoque le blob URL orphelin au démontage (évite les fuites mémoire).
  useEffect(() => {
    return () => {
      if (pendingLogo?.blobUrl) {
        try { URL.revokeObjectURL(pendingLogo.blobUrl); } catch { /* noop */ }
      }
    };
  }, [pendingLogo]);

  // Le fond du header : chaîne CSS unique manipulée par BackgroundInput.
  // On la reconvertit en {bgType,bgGradient|bgSolid} au save serveur pour
  // rester compatible avec l'ancien schéma de config.
  const headerBg = header.bgType === "gradient" ? header.bgGradient : header.bgSolid;
  function setHeaderBg(v: string | null) {
    const value = v ?? "#0f172a";
    if (isGradientString(value)) {
      setHeader((h) => ({ ...h, bgType: "gradient", bgGradient: value }));
    } else {
      setHeader((h) => ({ ...h, bgType: "solid", bgSolid: value }));
    }
  }

  async function saveHeader() {
    setSavingHeader(true);
    try {
      let finalHeader = header;
      // Si un logo est en attente d'upload : on l'envoie MAINTENANT au serveur
      // et on remplace le blob URL par le path définitif avant de persister
      // la config du header.
      if (pendingLogo) {
        const form = new FormData();
        form.append("image", pendingLogo.file);
        const res = await fetch("/api/admin/mail-branding/logo", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          toast({ type: "error", title: "Erreur", message: data.error || "Envoi du logo échoué" });
          return;
        }
        finalHeader = { ...header, logoUrl: data.path as string };
        setHeader(finalHeader);
        try { URL.revokeObjectURL(pendingLogo.blobUrl); } catch { /* noop */ }
        setPendingLogo(null);
      }
      const res = await updateMailHeaderConfig(finalHeader);
      if (res.success) toast({ type: "success", title: "En-tête enregistré" });
      else toast({ type: "error", title: "Erreur", message: res.error });
    } finally {
      setSavingHeader(false);
    }
  }
  async function saveFooter() {
    setSavingFooter(true);
    const res = await updateMailFooterConfig(footer);
    setSavingFooter(false);
    if (res.success) toast({ type: "success", title: "Pied de page enregistré" });
    else toast({ type: "error", title: "Erreur", message: res.error });
  }
  async function handleReset() {
    if (!confirm("Réinitialiser l'habillage des mails aux valeurs d'usine ?")) return;
    setResetting(true);
    const res = await resetMailBranding();
    setResetting(false);
    if (res.success) {
      setHeader(DEFAULT_MAIL_HEADER);
      setFooter(DEFAULT_MAIL_FOOTER);
      toast({ type: "success", title: "Habillage réinitialisé" });
    } else toast({ type: "error", title: "Erreur", message: res.error });
  }
  /**
   * L'admin choisit un fichier : on l'affiche immédiatement via un blob URL
   * local, on le garde en mémoire, mais on N'ENVOIE RIEN au serveur avant
   * qu'elle clique « Enregistrer l'en-tête ». Le blob URL s'affiche dans
   * l'aperçu à côté du bouton + dans la maquette du mail à droite.
   */
  function handleLogoPicked(file: File) {
    // Si un précédent logo en attente : révoquer son blob avant d'écraser.
    if (pendingLogo?.blobUrl) {
      try { URL.revokeObjectURL(pendingLogo.blobUrl); } catch { /* noop */ }
    }
    const blobUrl = URL.createObjectURL(file);
    setPendingLogo({ blobUrl, file });
    setHeader((h) => ({ ...h, logoUrl: blobUrl }));
  }

  /**
   * Retire le logo (aperçu). Si c'était un logo en attente, révoque le blob
   * et vide le pending — l'upload ne sera pas déclenché au save.
   */
  function handleLogoRemove() {
    if (pendingLogo?.blobUrl) {
      try { URL.revokeObjectURL(pendingLogo.blobUrl); } catch { /* noop */ }
    }
    setPendingLogo(null);
    setHeader((h) => ({ ...h, logoUrl: null }));
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      {/* Formulaires — 3 col sur xl, sinon full width */}
      <div className="xl:col-span-3 space-y-6">
        {/* En-tête */}
        <Section
          variant="header"
          title="En-tête (bandeau du haut)"
          subtitle="Fond, logo et couleur du titre du mail."
          action={
            <button
              type="button"
              onClick={saveHeader}
              disabled={savingHeader}
              className="px-4 py-2.5 rounded-lg text-[13px] font-body font-bold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingHeader ? "Enregistrement…" : "Enregistrer l'en-tête"}
            </button>
          }
        >
          <Field label="Fond du bandeau" hint="Couleur unie ou dégradé avec autant de couleurs que vous voulez.">
            <BackgroundInput
              value={headerBg}
              onChange={setHeaderBg}
              allowEmpty={false}
              defaultGradient="linear-gradient(135deg,#0f172a,#334155)"
            />
          </Field>

          <Field label="Couleur du titre">
            <ColorInput value={header.textColor} onChange={(v) => setHeader((h) => ({ ...h, textColor: v }))} />
          </Field>

          <Field label="Logo (optionnel)" hint="PNG transparent recommandé. Remplace le nom de boutique en surtitre.">
            <div className="flex items-center gap-4">
              {header.logoUrl ? (
                <div className="relative w-28 h-20 rounded-xl border border-border bg-bg-secondary flex items-center justify-center overflow-hidden">
                  {header.logoUrl.startsWith("blob:") ? (
                    // Blob local (logo en attente) : Next Image refuse les blob:,
                    // on utilise un <img> natif — pas d'optimisation nécessaire.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={header.logoUrl} alt="Logo mail (aperçu)" className="object-contain w-full h-full" />
                  ) : (
                    <Image src={header.logoUrl} alt="Logo mail" width={112} height={80} className="object-contain w-full h-full" />
                  )}
                </div>
              ) : (
                <div className="w-28 h-20 rounded-xl border border-dashed border-border-strong bg-bg-secondary flex items-center justify-center text-[12px] text-text-muted">
                  Aucun
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLogoPicked(f);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="px-4 py-2 rounded-lg text-[13px] font-body font-semibold bg-slate-800 text-white hover:bg-slate-900"
                >
                  {header.logoUrl ? "Remplacer le logo" : "Importer un logo"}
                </button>
                {header.logoUrl && (
                  <button
                    type="button"
                    onClick={handleLogoRemove}
                    className="px-4 py-2 rounded-lg text-[13px] font-body font-semibold text-red-700 hover:bg-red-50 border border-red-200"
                  >
                    Retirer le logo
                  </button>
                )}
                {pendingLogo && (
                  <p className="text-[11px] text-amber-700 leading-tight">
                    ⚠ Non enregistré — cliquez « Enregistrer l&apos;en-tête » pour appliquer.
                  </p>
                )}
              </div>
            </div>
          </Field>

          {header.logoUrl && (
            <Field label={`Hauteur max du logo — ${header.logoMaxHeight} px`}>
              <input
                type="range"
                min={24}
                max={120}
                step={2}
                value={header.logoMaxHeight}
                onChange={(e) => setHeader((h) => ({ ...h, logoMaxHeight: Number(e.target.value) }))}
                className="w-full"
              />
            </Field>
          )}

          {!header.logoUrl && (
            <Field label="Afficher le nom de la boutique en surtitre">
              <label className="flex items-center gap-2 text-[14px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={header.showShopName}
                  onChange={(e) => setHeader((h) => ({ ...h, showShopName: e.target.checked }))}
                  className="w-5 h-5 accent-emerald-600"
                />
                Oui, afficher « {shopName} » au-dessus du titre
              </label>
            </Field>
          )}
        </Section>

        {/* Footer */}
        <Section
          variant="footer"
          title="Pied de page"
          subtitle="Bloc du bas avec vos coordonnées et vos réseaux sociaux."
          action={
            <button
              type="button"
              onClick={saveFooter}
              disabled={savingFooter}
              className="px-4 py-2.5 rounded-lg text-[13px] font-body font-bold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingFooter ? "Enregistrement…" : "Enregistrer le pied"}
            </button>
          }
        >
          <Field label="Fond du pied de page" hint="Couleur unie ou dégradé — mêmes options que l'en-tête.">
            <BackgroundInput
              value={footer.bg}
              onChange={(v) => setFooter((f) => ({ ...f, bg: v ?? "#0f172a" }))}
              allowEmpty={false}
              defaultGradient="linear-gradient(135deg,#0f172a,#334155)"
            />
          </Field>

          <Field label="Couleur du texte">
            <ColorInput value={footer.textColor} onChange={(v) => setFooter((f) => ({ ...f, textColor: v }))} />
          </Field>

          <Field label="Message perso (optionnel)" hint={`Vide = "Vous recevez ce mail car vous êtes client ${shopName}."`}>
            <div className="space-y-2">
              <textarea
                ref={footerMessageRef}
                value={footer.customMessage ?? ""}
                onChange={(e) => setFooter((f) => ({ ...f, customMessage: e.target.value || null }))}
                rows={3}
                maxLength={500}
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-[14px] focus:outline-none focus:border-slate-500 resize-none"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-text-muted leading-snug">
                  Utilisez le bouton pour insérer <code className="bg-bg-secondary px-1 rounded">{"{firstName}"}</code>, <code className="bg-bg-secondary px-1 rounded">{"{shopName}"}</code>, etc. — remplacés à l&apos;envoi par la vraie info.
                </p>
                <InsertVariableButton
                  targetRef={footerMessageRef}
                  value={footer.customMessage ?? ""}
                  onChange={(v) => setFooter((f) => ({ ...f, customMessage: v || null }))}
                  label="Insérer une variable"
                />
              </div>
            </div>
          </Field>

          <Field label="Lien Instagram (optionnel)">
            <input
              type="url"
              value={footer.instagramUrl ?? ""}
              onChange={(e) => setFooter((f) => ({ ...f, instagramUrl: e.target.value || null }))}
              placeholder="https://instagram.com/votreboutique"
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-[14px] focus:outline-none focus:border-slate-500"
            />
          </Field>

          <Field label="Lien Facebook (optionnel)">
            <input
              type="url"
              value={footer.facebookUrl ?? ""}
              onChange={(e) => setFooter((f) => ({ ...f, facebookUrl: e.target.value || null }))}
              placeholder="https://facebook.com/votreboutique"
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-primary text-[14px] focus:outline-none focus:border-slate-500"
            />
          </Field>
        </Section>

        <div className="rounded-2xl border border-border bg-bg-secondary p-5 text-[13.5px] text-text-muted space-y-3">
          <p>
            Cette configuration s'applique automatiquement aux <strong>4 mails marketing</strong> : newsletter, retour en stock, panier abandonné, client inactif.
          </p>
          <p>
            Les autres mails (code OTP, mot de passe oublié, confirmation commande, expédition, facture, avoir…) gardent leur habillage d'origine.
          </p>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="mt-2 px-4 py-2 rounded-lg text-[13px] font-body font-semibold text-red-700 hover:bg-red-50 border border-red-200 disabled:opacity-60"
          >
            {resetting ? "Réinitialisation…" : "Réinitialiser aux valeurs d'usine"}
          </button>
        </div>
      </div>

      {/* Aperçu — 2 col sur xl, en-dessous sinon */}
      <div className="xl:col-span-2">
        <div className="xl:sticky xl:top-4">
          <div className="text-[11px] uppercase tracking-[0.18em] font-body font-bold text-text-muted mb-2">
            Aperçu en direct
          </div>
          <div className="rounded-2xl border border-border bg-slate-100 overflow-auto" style={{ maxHeight: 780 }}>
            <MailPreview
              header={header}
              footer={footer}
              shopName={shopName}
              legalLine={legalLine}
              baseUrl={baseUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Section (carte + header + action)

   `variant` code visuellement la position dans le mail (en-tête / pied de
   page) pour qu'à l'œil nu, la cliente ne confonde plus les 2 blocs :
   - bande verticale colorée à gauche (sky / slate)
   - petite icône schématique (rectangle en haut / en bas)
   - badge « EN-TÊTE » ou « PIED DE PAGE » dans le titre
   ───────────────────────────────────────────── */

type SectionVariant = "header" | "footer" | "neutral";

const VARIANT_STYLES: Record<SectionVariant, {
  bar: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  ring: string;
  badgeLabel: string;
}> = {
  header: {
    bar: "bg-gradient-to-b from-sky-400 to-sky-600",
    badgeBg: "bg-sky-50",
    badgeText: "text-sky-800",
    badgeBorder: "border-sky-200",
    ring: "ring-sky-100",
    badgeLabel: "En-tête",
  },
  footer: {
    bar: "bg-gradient-to-b from-slate-500 to-slate-800",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-800",
    badgeBorder: "border-slate-300",
    ring: "ring-slate-100",
    badgeLabel: "Pied de page",
  },
  neutral: {
    bar: "bg-border",
    badgeBg: "bg-bg-secondary",
    badgeText: "text-text-muted",
    badgeBorder: "border-border",
    ring: "ring-transparent",
    badgeLabel: "",
  },
};

function SectionIcon({ variant }: { variant: SectionVariant }) {
  if (variant === "neutral") return null;
  // Rectangle représentant une enveloppe mail, avec une bande pleine soit en
  // haut (en-tête) soit en bas (pied de page) pour situer visuellement.
  const isHeader = variant === "header";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="4" y="5" width="20" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      {isHeader ? (
        <rect x="4" y="5" width="20" height="6" rx="3" fill="currentColor" />
      ) : (
        <rect x="4" y="17" width="20" height="6" rx="3" fill="currentColor" />
      )}
    </svg>
  );
}

function Section({
  title,
  subtitle,
  action,
  variant = "neutral",
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  variant?: SectionVariant;
  children: React.ReactNode;
}) {
  const style = VARIANT_STYLES[variant];
  const iconColor = variant === "header" ? "text-sky-600" : variant === "footer" ? "text-slate-700" : "text-text-muted";
  return (
    <section
      className={`relative rounded-2xl border border-border bg-bg-primary p-5 sm:p-6 pl-6 sm:pl-7 space-y-5 shadow-sm ring-4 ${style.ring} overflow-hidden`}
    >
      {/* Bande verticale colorée sur toute la hauteur — repère fort */}
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-1.5 ${style.bar}`} />

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`shrink-0 ${iconColor}`}>
            <SectionIcon variant={variant} />
          </div>
          <div className="min-w-0">
            {style.badgeLabel && (
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-body font-bold uppercase tracking-wider border ${style.badgeBg} ${style.badgeText} ${style.badgeBorder} mb-1.5`}
              >
                {style.badgeLabel}
              </span>
            )}
            <h4 className="font-heading text-[17px] font-bold text-text-primary leading-tight">{title}</h4>
            {subtitle && <p className="text-[13px] text-text-muted mt-1">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Field
   ───────────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] uppercase tracking-[0.14em] font-body font-bold text-text-muted mb-2">{label}</label>
      {children}
      {hint && <p className="text-[12px] text-text-muted mt-1.5">{hint}</p>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Aperçu React (rendu inline, MàJ instantanée)
   ───────────────────────────────────────────── */

function MailPreview({
  header,
  footer,
  shopName,
  legalLine,
  baseUrl,
}: {
  header: MailHeaderConfig;
  footer: MailFooterConfig;
  shopName: string;
  legalLine: string;
  baseUrl: string;
}) {
  const bg = header.bgType === "solid" ? header.bgSolid : header.bgGradient;
  const logoSrc = header.logoUrl
    ? header.logoUrl.startsWith("http") || header.logoUrl.startsWith("blob:")
      ? header.logoUrl
      : `${baseUrl}${header.logoUrl.startsWith("/") ? "" : "/"}${header.logoUrl}`
    : null;

  const message =
    footer.customMessage?.trim() || `Vous recevez ce mail car vous êtes client ${shopName}.`;

  const hasInsta = !!footer.instagramUrl?.trim();
  const hasFb = !!footer.facebookUrl?.trim();

  return (
    <div style={{ background: "#f1f5f9", padding: "20px 12px" }}>
      <div
        style={{
          maxWidth: 600,
          margin: "0 auto",
          background: "#ffffff",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 4px 24px rgba(15,23,42,0.08)",
          fontFamily: "-apple-system, 'Roboto', sans-serif",
          color: "#0f172a",
        }}
      >
        {/* Header */}
        <div style={{ background: bg, padding: "36px 24px", color: header.textColor, textAlign: "center" }}>
          {logoSrc ? (
            <div style={{ marginBottom: 14 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoSrc}
                alt={shopName}
                style={{ maxHeight: header.logoMaxHeight, display: "inline-block", border: 0 }}
              />
            </div>
          ) : header.showShopName ? (
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                opacity: 0.85,
                marginBottom: 8,
                color: header.textColor,
              }}
            >
              {shopName}
            </div>
          ) : null}
          <h1
            style={{
              fontFamily: "'Poppins', sans-serif",
              fontSize: 24,
              fontWeight: 700,
              margin: 0,
              color: header.textColor,
            }}
          >
            Sujet du mail
          </h1>
        </div>

        {/* Corps placeholder */}
        <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
          Contenu du mail
          <br />
          (variable selon le type)
        </div>

        {/* Footer */}
        <div style={{ background: footer.bg, color: footer.textColor, padding: 24, textAlign: "center" }}>
          <div
            style={{
              fontFamily: "'Poppins', sans-serif",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.02em",
              marginBottom: 6,
              color: footer.textColor,
            }}
          >
            {shopName}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 12, color: footer.textColor }}>{legalLine}</div>
          {(hasInsta || hasFb) && (
            <div style={{ margin: "12px 0" }}>
              {hasInsta && <SocialIcon kind="instagram" color={footer.textColor} />}
              {hasFb && <SocialIcon kind="facebook" color={footer.textColor} />}
            </div>
          )}
          <div style={{ fontSize: 10, opacity: 0.4, color: footer.textColor }}>{message}</div>
        </div>
      </div>
    </div>
  );
}

function SocialIcon({ kind, color }: { kind: "instagram" | "facebook"; color: string }) {
  return (
    <span style={{ display: "inline-block", margin: "0 6px" }}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ verticalAlign: "middle" }}
      >
        {kind === "instagram" ? (
          <>
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </>
        ) : (
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
        )}
      </svg>
    </span>
  );
}
