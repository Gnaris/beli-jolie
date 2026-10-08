"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/Toast";
import CustomSelect from "@/components/ui/CustomSelect";
import {
  createWhatsAppTemplate,
  updateWhatsAppTemplate,
  translateWhatsAppTemplateBody,
  type WhatsAppTemplateDTO,
  type SaveTranslationReport,
} from "@/app/actions/admin/whatsapp-templates";
import { getWhatsAppPreviewContext } from "@/app/actions/admin/whatsapp-preview";
import {
  WHATSAPP_VARIABLES,
  WHATSAPP_TEMPLATE_TITLE_MAX,
  WHATSAPP_TEMPLATE_BODY_MAX,
  WHATSAPP_TEMPLATE_PLACEHOLDER,
  WHATSAPP_NO_EMOJI_ERROR,
  containsEmoji,
  renderWhatsAppMessage,
  buildWhatsAppPreviewContext,
  type WhatsAppMergeContext,
} from "@/lib/whatsapp-message";
import { VARIABLE_GROUP_LABELS } from "@/lib/mail-merge-variables";
import { buildWhatsAppAiPrompt } from "@/lib/whatsapp-ai-prompt";
import { getNewsletterEditorBaseUrl } from "@/app/actions/admin/newsletter-links";
import type { WhatsAppTargetLocale } from "@/lib/whatsapp-translate";
import LinkPickerModal from "@/components/admin/shared/LinkPickerModal";
import WhatsAppMarkdownPreview from "./WhatsAppMarkdownPreview";
import type { WhatsAppPreviewClient } from "./WhatsAppTemplatesPane";

interface Props {
  template: WhatsAppTemplateDTO | null;
  previewOverrides: Record<string, string>;
  clients: WhatsAppPreviewClient[];
  onClose: () => void;
}

const ADMIN_AS_CLIENT_ID = "__admin__";

type DrawerLocale = "fr" | WhatsAppTargetLocale;

/** Ordre d'affichage dans les onglets. FR en premier (source), puis EN, DE, IT, ES. */
const LOCALE_TABS: Array<{ code: DrawerLocale; label: string }> = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
  { code: "de", label: "DE" },
  { code: "it", label: "IT" },
  { code: "es", label: "ES" },
];

/** Nom long en français — utilisé dans les messages d'erreur / toasts. */
const LOCALE_LONG: Record<DrawerLocale, string> = {
  fr: "français",
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
};

/** Placeholders localisés — montrent à quoi un modèle vide ressemble dans
 *  l'onglet correspondant pour aider la cliente à visualiser. */
const PLACEHOLDERS: Record<DrawerLocale, string> = {
  fr: WHATSAPP_TEMPLATE_PLACEHOLDER,
  en: "Hi {firstName}, this is {adminFirstName} from {shopName}.",
  de: "Hallo {firstName}, hier ist {adminFirstName} von {shopName}.",
  it: "Ciao {firstName}, sono {adminFirstName} di {shopName}.",
  es: "Hola {firstName}, soy {adminFirstName} de {shopName}.",
};

export default function WhatsAppTemplateDrawer({ template, previewOverrides, clients, onClose }: Props) {
  const [title, setTitle] = useState(template?.title ?? "");

  // Un state par locale — le FR est la source, les 4 autres sont optionnelles.
  const [bodies, setBodies] = useState<Record<DrawerLocale, string>>({
    fr: template?.body ?? "",
    en: template?.bodyEn ?? "",
    de: template?.bodyDe ?? "",
    it: template?.bodyIt ?? "",
    es: template?.bodyEs ?? "",
  });

  const [pending, startTransition] = useTransition();
  const [translating, setTranslating] = useState<DrawerLocale | null>(null);

  // Aperçu — sélection client + onglet actif pilote le body affiché.
  const [previewClientId, setPreviewClientId] = useState<string>(ADMIN_AS_CLIENT_ID);
  const [activeLocale, setActiveLocale] = useState<DrawerLocale>("fr");
  const [liveContext, setLiveContext] = useState<WhatsAppMergeContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const toast = useToast();

  // Refs par locale pour l'insertion de variables / liens au curseur.
  const textareaRefs = useRef<Record<DrawerLocale, HTMLTextAreaElement | null>>({
    fr: null,
    en: null,
    de: null,
    it: null,
    es: null,
  });

  // Escape ferme
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Charge le contexte réel quand la cliente sélectionne un vrai client.
  useEffect(() => {
    if (previewClientId === ADMIN_AS_CLIENT_ID) {
      setLiveContext(null);
      return;
    }
    let cancelled = false;
    setLoadingContext(true);
    getWhatsAppPreviewContext(previewClientId).then((res) => {
      if (cancelled) return;
      setLoadingContext(false);
      if (res.success) {
        setLiveContext(res.context);
      } else {
        toast.error("Impossible de charger le client", res.error);
        setLiveContext(null);
      }
    });
    return () => { cancelled = true; };
  }, [previewClientId, toast]);

  const adminAsClientCtx = buildWhatsAppPreviewContext({
    ...previewOverrides,
    firstName: previewOverrides.adminFirstName || "",
    lastName: previewOverrides.adminLastName || "",
    fullName: `${previewOverrides.adminFirstName ?? ""} ${previewOverrides.adminLastName ?? ""}`.trim(),
    company: previewOverrides.shopName || "",
  });

  const previewCtx = liveContext ?? adminAsClientCtx;
  const activeBody = bodies[activeLocale];
  const activePlaceholder = PLACEHOLDERS[activeLocale];
  const preview = renderWhatsAppMessage(activeBody || activePlaceholder, previewCtx);

  const selectedClient = clients.find((c) => c.id === previewClientId);
  const adminLabel = previewOverrides.adminFirstName
    ? `Moi — ${previewOverrides.adminFirstName}${previewOverrides.adminLastName ? ` ${previewOverrides.adminLastName}` : ""}`
    : "Moi (admin)";
  const previewLabel = selectedClient
    ? `${selectedClient.firstName} ${selectedClient.lastName}${selectedClient.company ? ` · ${selectedClient.company}` : ""}`
    : adminLabel;

  const clientOptions = [
    { value: ADMIN_AS_CLIENT_ID, label: `${adminLabel} (défaut)` },
    ...clients.map((c) => ({
      value: c.id,
      label: `${c.firstName} ${c.lastName}${c.company ? ` · ${c.company}` : ""}`,
    })),
  ];

  const titleOver = title.length > WHATSAPP_TEMPLATE_TITLE_MAX;
  const titleHasEmoji = containsEmoji(title);

  const localeOver: Record<DrawerLocale, boolean> = {
    fr: bodies.fr.length > WHATSAPP_TEMPLATE_BODY_MAX,
    en: bodies.en.length > WHATSAPP_TEMPLATE_BODY_MAX,
    de: bodies.de.length > WHATSAPP_TEMPLATE_BODY_MAX,
    it: bodies.it.length > WHATSAPP_TEMPLATE_BODY_MAX,
    es: bodies.es.length > WHATSAPP_TEMPLATE_BODY_MAX,
  };
  const localeHasEmoji: Record<DrawerLocale, boolean> = {
    fr: containsEmoji(bodies.fr),
    en: containsEmoji(bodies.en),
    de: containsEmoji(bodies.de),
    it: containsEmoji(bodies.it),
    es: containsEmoji(bodies.es),
  };

  const anyBodyOver = Object.values(localeOver).some(Boolean);
  const anyBodyEmoji = Object.values(localeHasEmoji).some(Boolean);

  const canSave =
    title.trim().length > 0 &&
    bodies.fr.trim().length > 0 &&
    !titleOver &&
    !anyBodyOver &&
    !titleHasEmoji &&
    !anyBodyEmoji;

  function updateBody(locale: DrawerLocale, next: string) {
    setBodies((prev) => ({ ...prev, [locale]: next }));
  }

  function insertAtCursor(insert: string) {
    const ta = textareaRefs.current[activeLocale];
    if (!ta) {
      updateBody(activeLocale, `${bodies[activeLocale]}${insert}`);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = bodies[activeLocale];
    updateBody(activeLocale, current.slice(0, start) + insert + current.slice(end));
    requestAnimationFrame(() => {
      const el = textareaRefs.current[activeLocale];
      if (el) {
        el.focus();
        const pos = start + insert.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function insertVariable(token: string) {
    insertAtCursor(`{${token}}`);
  }

  function handleTranslate(target: WhatsAppTargetLocale) {
    const bodyFr = bodies.fr;
    if (!bodyFr.trim()) {
      toast.error("Écris d'abord le message en français", "Le contenu FR est vide.");
      return;
    }
    if (localeHasEmoji.fr) {
      toast.error("Retire les emojis du texte français", WHATSAPP_NO_EMOJI_ERROR);
      return;
    }
    setTranslating(target);
    translateWhatsAppTemplateBody(bodyFr, target)
      .then((res) => {
        if (res.success) {
          updateBody(target, res.body);
          setActiveLocale(target);
          toast.success(
            `Version ${LOCALE_LONG[target]} générée`,
            "Tu peux la relire et la modifier avant d'enregistrer.",
          );
        } else {
          toast.error("Traduction indisponible", res.error);
        }
      })
      .finally(() => setTranslating(null));
  }

  function handleSave() {
    startTransition(async () => {
      const payload = {
        title,
        body: bodies.fr,
        bodyEn: bodies.en,
        bodyDe: bodies.de,
        bodyIt: bodies.it,
        bodyEs: bodies.es,
      };
      const res = template
        ? await updateWhatsAppTemplate(template.id, payload)
        : await createWhatsAppTemplate(payload);
      if (res.success) {
        reportSaveToast(res.report, Boolean(template), toast);
        onClose();
      } else {
        toast.error("Échec", res.error);
      }
    });
  }

  const grouped = WHATSAPP_VARIABLES.reduce<Record<string, typeof WHATSAPP_VARIABLES>>((acc, v) => {
    (acc[v.group] ||= []).push(v);
    return acc;
  }, {});

  if (!mounted) return null;

  const currentBody = bodies[activeLocale];
  const currentOver = localeOver[activeLocale];
  const currentEmoji = localeHasEmoji[activeLocale];

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-drawer-title"
        className="fixed inset-y-0 right-0 z-[101] w-full sm:max-w-2xl bg-bg-primary shadow-2xl overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-body font-bold uppercase tracking-[0.18em] text-emerald-700">
                {template ? "Modifier" : "Nouveau"}
              </p>
              <h2 id="wa-drawer-title" className="font-heading text-xl font-bold text-text-primary mt-0.5">
                {template ? template.title : "Modèle WhatsApp"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              aria-label="Fermer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l12 12M18 6l-12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Aperçu en HAUT — le CustomSelect s'ouvre vers le bas et a besoin
              d'espace disponible sous lui pour afficher la liste complète des
              clients. */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-emerald-700">
                Aperçu — {previewLabel}
                {loadingContext && <span className="ml-2 text-emerald-800/60 normal-case tracking-normal">chargement…</span>}
              </p>
              <div
                role="tablist"
                aria-label="Langue de l'aperçu"
                className="inline-flex rounded-lg border border-emerald-300 bg-white overflow-hidden text-[11px] font-body font-semibold"
              >
                {LOCALE_TABS.map((t) => {
                  const filled = bodies[t.code].trim().length > 0;
                  return (
                    <button
                      key={t.code}
                      type="button"
                      role="tab"
                      aria-selected={activeLocale === t.code}
                      onClick={() => setActiveLocale(t.code)}
                      title={
                        t.code === "fr"
                          ? "Message source (obligatoire)"
                          : filled
                            ? `Version ${LOCALE_LONG[t.code]} prête`
                            : `Version ${LOCALE_LONG[t.code]} vide — fallback sur anglais puis français à l'envoi`
                      }
                      className={`relative px-3 h-7 ${
                        activeLocale === t.code
                          ? "bg-emerald-600 text-white"
                          : filled || t.code === "fr"
                            ? "text-emerald-700 hover:bg-emerald-50"
                            : "text-emerald-700/50 hover:bg-emerald-50"
                      }`}
                    >
                      {t.label}
                      {t.code !== "fr" && !filled && (
                        <span
                          aria-hidden
                          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-3">
              <CustomSelect
                value={previewClientId}
                onChange={setPreviewClientId}
                options={clientOptions}
                searchable
                aria-label="Choisir le client pour l'aperçu"
                emptyMessage="Aucun client APPROVED — l'aperçu utilise vos infos admin"
                title="Choisir un client pour l'aperçu"
              />
            </div>
            {preview.trim() ? (
              <WhatsAppMarkdownPreview
                text={preview}
                className="text-[14px] font-body text-emerald-900 leading-relaxed"
              />
            ) : (
              <p className="text-[14px] font-body italic text-emerald-800/60">— message vide —</p>
            )}
            <p className="mt-3 text-[11px] font-body text-emerald-800/60">
              💡 <code className="rounded bg-emerald-100 px-1">*gras*</code>{" "}
              <code className="rounded bg-emerald-100 px-1">_italique_</code>{" "}
              <code className="rounded bg-emerald-100 px-1">~barré~</code>{" "}
              — reconnu par WhatsApp
            </p>
          </div>

          {/* Titre */}
          <div>
            <label className="block text-[12px] font-body font-semibold text-text-primary mb-1.5">
              Titre <span className="text-text-muted font-normal">(usage interne, pas envoyé)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bienvenue nouveau client"
              className="w-full rounded-xl border border-border bg-bg-primary px-3 h-11 text-[14px] font-body text-text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100"
            />
            <p className={`mt-1 text-[11px] font-body ${titleOver ? "text-red-600 font-semibold" : "text-text-muted"}`}>
              {title.length}/{WHATSAPP_TEMPLATE_TITLE_MAX}
            </p>
            {titleHasEmoji && (
              <p className="mt-1 text-[11px] font-body text-red-600 font-semibold">
                {WHATSAPP_NO_EMOJI_ERROR}
              </p>
            )}
          </div>

          {/* Zone de rédaction — un seul textarea à la fois, piloté par l'onglet actif. */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
              <label className="block text-[12px] font-body font-semibold text-text-primary">
                Contenu du message{" "}
                <span className="text-text-muted font-normal">({LOCALE_LONG[activeLocale]})</span>
                {activeLocale === "fr" && (
                  <span className="ml-2 text-[10px] font-body font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Source
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeLocale !== "fr" && (
                  <button
                    type="button"
                    onClick={() => handleTranslate(activeLocale)}
                    disabled={
                      translating !== null ||
                      pending ||
                      !bodies.fr.trim() ||
                      localeHasEmoji.fr
                    }
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg border border-sky-300 bg-sky-50 text-sky-700 text-[11.5px] font-body font-medium hover:bg-sky-100 hover:border-sky-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={`Traduire automatiquement en ${LOCALE_LONG[activeLocale]} depuis le texte français`}
                  >
                    {translating === activeLocale
                      ? "Traduction…"
                      : `🌐 Traduire en ${LOCALE_LONG[activeLocale]}`}
                  </button>
                )}
                <InsertLinkButton onInsert={insertAtCursor} />
              </div>
            </div>
            <textarea
              ref={(el) => { textareaRefs.current[activeLocale] = el; }}
              value={currentBody}
              onChange={(e) => updateBody(activeLocale, e.target.value)}
              rows={7}
              placeholder={activePlaceholder}
              className="w-full rounded-xl border border-border bg-bg-primary px-3 py-2 text-[14px] font-body text-text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-100 resize-y"
            />
            <p className={`mt-1 text-[11px] font-body ${currentOver ? "text-red-600 font-semibold" : "text-text-muted"}`}>
              {currentBody.length}/{WHATSAPP_TEMPLATE_BODY_MAX}
            </p>
            {currentEmoji && (
              <p className="mt-1 text-[11px] font-body text-red-600 font-semibold">
                {WHATSAPP_NO_EMOJI_ERROR}
              </p>
            )}
            {activeLocale !== "fr" && (
              <p className="mt-1 text-[11px] font-body text-text-muted">
                Si vide, le message retombera sur l&apos;anglais, puis sur le français. Cette version est
                regénérée automatiquement à chaque enregistrement quand tu la laisses vide.
              </p>
            )}
          </div>

          {/* Variables */}
          <div>
            <label className="block text-[12px] font-body font-semibold text-text-primary mb-2">
              Variables — cliquez pour insérer dans le champ {LOCALE_LONG[activeLocale]}
            </label>
            <div className="space-y-3">
              {Object.entries(grouped).map(([group, vars]) => (
                <div key={group}>
                  <p className="text-[10px] font-body font-bold uppercase tracking-[0.14em] text-text-muted mb-1.5">
                    {VARIABLE_GROUP_LABELS[group as keyof typeof VARIABLE_GROUP_LABELS] ?? group}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {vars.map((v) => (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => insertVariable(v.token)}
                        title={v.hint ?? v.label}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-bg-secondary hover:border-emerald-300 hover:bg-emerald-50 text-[11.5px] font-body text-text-secondary transition-colors"
                      >
                        <span className="font-mono text-emerald-700">{`{${v.token}}`}</span>
                        <span className="text-text-muted">— {v.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <AiPromptSection body={bodies.fr} />

        </div>

        <div className="sticky bottom-0 bg-bg-primary border-t border-border px-6 py-4 flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl border border-border bg-bg-primary text-text-secondary text-[13px] font-body font-medium hover:border-border-strong disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || !canSave}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 text-white text-[13px] font-body font-semibold shadow-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Enregistrement…" : template ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/**
 * Compose le toast de sauvegarde selon le rapport de traduction. Affiche un
 * succès simple quand tout est OK, ou un succès nuancé listant les langues
 * dont l'auto-trad a échoué (la cliente peut retenter plus tard via le
 * bouton « Traduire »).
 */
function reportSaveToast(
  report: SaveTranslationReport,
  isUpdate: boolean,
  toast: ReturnType<typeof useToast>,
) {
  const failed = report.translationFailedLocales;
  const headline = isUpdate ? "Modèle mis à jour" : "Modèle créé";
  if (failed.length === 0) {
    toast.success(headline);
    return;
  }
  const names = failed.map((l) => LOCALE_LONG[l]).join(", ");
  toast.success(
    headline,
    `Français enregistré. Traduction indisponible pour : ${names}. Tu peux retenter plus tard via « Traduire » ou écrire ces versions à la main.`,
  );
}

/* ─────────────────────────────────────────────
   Bouton compact : Insérer un lien
   ───────────────────────────────────────────── */

function InsertLinkButton({ onInsert }: { onInsert: (text: string) => void }) {
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>("");

  useEffect(() => {
    if (!pickerOpen || baseUrl) return;
    getNewsletterEditorBaseUrl()
      .then(setBaseUrl)
      .catch(() => {});
  }, [pickerOpen, baseUrl]);

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 h-7 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-[11.5px] font-body font-medium hover:bg-emerald-100 hover:border-emerald-400 transition-colors"
        title="Choisir un lien à insérer à la position du curseur"
      >
        🔗 Insérer un lien
      </button>

      {pickerOpen && (
        <LinkPickerModal
          currentHref=""
          baseUrl={baseUrl}
          onClose={() => setPickerOpen(false)}
          onValidate={(url) => {
            onInsert(` ${url} `);
            setPickerOpen(false);
            toast.success("Lien inséré", "Il apparaîtra cliquable dans WhatsApp.");
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Sous-section : Prompt IA
   ───────────────────────────────────────────── */

function AiPromptSection({ body }: { body: string }) {
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const prompt = useMemo(() => buildWhatsAppAiPrompt({ description }), [description]);

  async function handleCopy() {
    if (!description.trim()) {
      toast.error(
        "Décris ton message d'abord",
        "Écris quelques lignes sur le contexte : à qui tu envoies, pourquoi, l'info principale à faire passer.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success("Prompt copié", "Colle-le dans ChatGPT / Claude — l'IA te renverra le texte du message.");
    } catch {
      toast.error("Copie manuelle", "Ouvre le prompt ci-dessous et fais Ctrl+C.");
    }
  }

  return (
    <div>
      <label className="block text-[12px] font-body font-semibold text-text-primary mb-2">
        Prompt IA
        <span className="text-text-muted font-normal"> — décris le contexte, une IA rédige le message</span>
      </label>
      <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex : Message de bienvenue pour un nouveau client B2B qui vient d'être approuvé. Ton chaleureux, présenter la boutique en 1 ligne, inviter à découvrir le catalogue avec le lien, signature perso."
          rows={4}
          className="w-full rounded-lg border border-violet-200 bg-bg-primary px-3 py-2 text-[13px] font-body text-text-primary focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-y"
        />
        <p className="text-[11px] font-body text-text-secondary">
          Le prompt final listera <strong>toutes les variables disponibles</strong>{" "}
          (<code className="rounded bg-white px-1">{`{firstName}`}</code>,{" "}
          <code className="rounded bg-white px-1">{`{shopName}`}</code>,{" "}
          <code className="rounded bg-white px-1">{`{adminFirstName}`}</code>…), les contraintes WhatsApp (1000 caractères, formatage <code className="rounded bg-white px-1">*gras*</code>, URL en clair) et ta description.
          {body.trim() && (
            <> Le corps actuel du modèle n&apos;est pas envoyé à l&apos;IA — décris juste ce que tu veux qu&apos;elle rédige.</>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg bg-violet-600 text-white text-[13px] font-body font-semibold hover:bg-violet-700"
          >
            Copier le prompt pour l&apos;IA
          </button>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg bg-bg-primary border border-border text-text-secondary text-[13px] font-body hover:border-border-strong"
          >
            {showPreview ? "Masquer" : "Voir"} le prompt complet
          </button>
        </div>
        {showPreview && (
          <pre className="mt-1 max-h-[320px] overflow-auto text-[11px] font-mono leading-relaxed p-3 bg-white border border-violet-200 rounded-lg whitespace-pre-wrap text-text-primary">
            {prompt}
          </pre>
        )}
      </div>
    </div>
  );
}
